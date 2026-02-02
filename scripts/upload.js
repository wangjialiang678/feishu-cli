import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { createDocument } from '../api/feishu.js';
import { markdownToBlocks } from '../api/feishu-md.js';

const API_BASE = 'https://open.feishu.cn/open-apis';
const BATCH_SIZE = 50;

async function apiPost(path, token, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`API error (${data.code}): ${data.msg}`);
  }
  return data.data;
}

async function apiGet(path, token, query = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`API error (${data.code}): ${data.msg}`);
  }
  return data.data;
}

async function uploadBlocks(docId, token, blocks) {
  // Split into table and non-table, upload sequentially without index
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
        // Binary search for bad blocks
        if (chunk.length === 1) {
          console.error(`  Skip 1 bad block`);
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
      // Create empty table
      const tableBlock = {
        block_type: 31,
        table: { property: { row_size: rowSize, column_size: colSize, header_row: true } },
      };
      try {
        const resp = await apiPost(`/docx/v1/documents/${docId}/blocks/${docId}/children`, token, { children: [tableBlock] });
        const tableId = resp.children?.[0]?.block_id;
        if (tableId) {
          await new Promise(r => setTimeout(r, 300));
          const cellResp = await apiGet(`/docx/v1/documents/${docId}/blocks/${tableId}/children`, token, { page_size: 500 });
          const cells = cellResp.items || [];
          // Fill cells: _table.rows[r][c] is a string, convert to text block
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
              } catch {}
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
    console.error('Usage: node scripts/upload-doc.js <markdown-file>');
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
