import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPost, apiGet, createDocument } from '../api/feishu.js';
import { markdownToBlocks } from '../api/feishu-md.js';

const BATCH_SIZE = 50;

function isRetryableError(err) {
  const msg = err.message || '';
  return msg.includes('429') || msg.includes('rate limited') || msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
}

async function fetchAllCells(docId, token, tableId, expectedCount) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cells = [];
    let pageToken;
    do {
      const query = { page_size: 500 };
      if (pageToken) query.page_token = pageToken;
      const resp = await apiGet(`/docx/v1/documents/${docId}/blocks/${tableId}/children`, token, query);
      if (resp.items) cells.push(...resp.items);
      pageToken = resp.page_token;
    } while (pageToken);
    if (!expectedCount || cells.length >= expectedCount) return cells;
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  }
  // Final attempt
  const cells = [];
  let pageToken;
  do {
    const query = { page_size: 500 };
    if (pageToken) query.page_token = pageToken;
    const resp = await apiGet(`/docx/v1/documents/${docId}/blocks/${tableId}/children`, token, query);
    if (resp.items) cells.push(...resp.items);
    pageToken = resp.page_token;
  } while (pageToken);
  return cells;
}

async function uploadBlocks(docId, token, blocks) {
  let pending = [];
  let added = 0, failed = 0;

  const flush = async () => {
    if (!pending.length) return;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      try {
        await apiPost(`/docx/v1/documents/${docId}/blocks/${docId}/children`, token, { children: chunk });
        added += chunk.length;
      } catch (err) {
        if (isRetryableError(err)) {
          // Retryable error — don't binary-search, just rethrow so caller sees it
          throw err;
        }
        // Content error — binary search for bad blocks
        if (chunk.length === 1) {
          console.error(`  Skip 1 bad block: ${err.message}`);
          failed += 1;
        } else {
          const mid = Math.floor(chunk.length / 2);
          pending = [...chunk.slice(0, mid)];
          await flush();
          pending = [...chunk.slice(mid)];
          await flush();
          return;
        }
      }
    }
    pending = [];
  };

  for (const block of blocks) {
    if (block.block_type === 31 && block._table) {
      await flush();
      const rowSize = block._table.rows.length;
      const colSize = block.table?.property?.column_size || block._table.rows[0]?.length || 1;
      // Calculate column widths based on max text length per column
      const colMaxLen = new Array(colSize).fill(0);
      for (const row of block._table.rows) {
        if (!row) continue;
        for (let c = 0; c < row.length && c < colSize; c++) {
          const text = typeof row[c] === 'string' ? row[c] : '';
          colMaxLen[c] = Math.max(colMaxLen[c], text.length);
        }
      }
      const MIN_COL_WIDTH = 80;
      const MAX_COL_WIDTH = 400;
      const CHAR_WIDTH = 14;
      const columnWidth = colMaxLen.map(len => Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, len * CHAR_WIDTH)));
      const tableBlock = {
        block_type: 31,
        table: { property: { row_size: rowSize, column_size: colSize, header_row: true, column_width: columnWidth } },
      };
      try {
        const resp = await apiPost(`/docx/v1/documents/${docId}/blocks/${docId}/children`, token, { children: [tableBlock] });
        const tableId = resp.children?.[0]?.block_id;
        if (tableId) {
          const expectedCellCount = rowSize * colSize;
          await new Promise(r => setTimeout(r, 800));
          const cells = await fetchAllCells(docId, token, tableId, expectedCellCount);
          for (let r = 0; r < rowSize; r++) {
            const row = block._table.rows[r];
            if (!row) continue;
            for (let c = 0; c < row.length; c++) {
              const cellText = typeof row[c] === 'string' ? row[c] : '';
              if (!cellText.trim()) continue;
              const idx = r * colSize + c;
              if (idx >= cells.length) continue;
              const cellId = cells[idx].block_id;
              const textBlock = {
                block_type: 2,
                text: { style: {}, elements: [{ text_run: { content: cellText, text_element_style: {} } }] },
              };
              try {
                await apiPost(`/docx/v1/documents/${docId}/blocks/${cellId}/children`, token, { children: [textBlock] });
              } catch (cellErr) {
                console.error(`  Cell [${r},${c}] failed: ${cellErr.message}`);
              }
              await new Promise(r => setTimeout(r, 50));
            }
          }
          added += 1;
          console.log(`  Table ${rowSize}x${colSize}`);
        }
      } catch (err) {
        console.error(`  Table failed: ${err.message}`);
        failed += 1;
      }
    } else {
      pending.push(block);
    }
  }
  await flush();
  return { added, failed };
}

async function main() {
  const config = await readConfig();
  const inputPathArg = process.argv[2];
  if (!inputPathArg) {
    console.error('Usage: node scripts/upload.js <markdown-file>');
    process.exit(1);
  }
  const inputPath = resolvePath(inputPathArg);
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));

  const markdown = await fs.readFile(inputPath, 'utf8');
  const token = await readToken(tokenPath);

  const { title, blocks } = markdownToBlocks(markdown);
  const { documentId, usedTitle } = await createDocument(token, title);

  const contentBlocks = usedTitle
    ? blocks
    : [
        {
          block_type: 3,
          heading1: { style: {}, elements: [{ text_run: { content: title, text_element_style: {} } }] },
        },
        ...blocks,
      ];

  const tableCount = contentBlocks.filter(b => b.block_type === 31 && b._table).length;
  const normalCount = contentBlocks.length - tableCount;
  console.log(`Parsed: ${normalCount} blocks + ${tableCount} tables`);

  const { added, failed } = await uploadBlocks(documentId, token, contentBlocks);
  console.log(`Done: ${added} added, ${failed} failed`);
  console.log(`https://feishu.cn/docx/${documentId}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
