import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPost, createDocument, tempId, buildTableDescendants, stripMarkdownForWidth, getDisplayWidth, calculateColumnWidths } from '../api/feishu.js';
import { markdownToBlocks, inlineMarkdownToElements, BLOCK_TYPE } from '../api/feishu-md.js';

const BATCH_SIZE = 50;
const MAX_BATCH_DESCENDANT_ROWS = 9;

function isRetryableError(err) {
  const msg = err.message || '';
  return msg.includes('429') || msg.includes('rate limited') || msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
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
    if (block.block_type === BLOCK_TYPE.table && block._table) {
      await flush();
      const rows = block._table.rows;
      const rowSize = rows.length;
      const colSize = block.table?.property?.column_size || rows[0]?.length || 1;

      const columnWidth = calculateColumnWidths(rows, colSize);

      try {
        if (rowSize <= MAX_BATCH_DESCENDANT_ROWS) {
          // Fast path: Batch Descendants for small tables (≤9 rows)
          const { tableId, descendants } = buildTableDescendants(rows, colSize, columnWidth);
          await apiPost(
            `/docx/v1/documents/${docId}/blocks/${docId}/descendant`,
            token,
            { children_id: [tableId], descendants },
            { document_revision_id: -1 },
          );
          added += 1;
          console.log(`  Table ${rowSize}x${colSize}`);
        } else {
          // Large table: create empty table, then fill cells
          const payload = {
            block_type: BLOCK_TYPE.table,
            table: {
              property: {
                row_size: rowSize,
                column_size: colSize,
                header_row: true,
                header_column: false,
                column_width: columnWidth,
              },
            },
          };
          const resp = await apiPost(
            `/docx/v1/documents/${docId}/blocks/${docId}/children`,
            token,
            { children: [payload] },
          );
          const createdTable = (Array.isArray(resp.children) ? resp.children : [])[0];
          const cellIds = createdTable?.table?.cells || [];

          if (cellIds.length) {
            for (let r = 0; r < rows.length; r += 1) {
              for (let c = 0; c < rows[r].length; c += 1) {
                const cellId = cellIds[r * colSize + c];
                if (!cellId) continue;
                const cellContent = rows[r][c] || '';
                if (!cellContent.trim()) continue;
                const elements = inlineMarkdownToElements(cellContent);
                const children = [{
                  block_type: BLOCK_TYPE.text,
                  text: { style: {}, elements },
                }];
                await apiPost(
                  `/docx/v1/documents/${docId}/blocks/${cellId}/children`,
                  token,
                  { index: 0, children },
                );
              }
            }
          }
          added += 1;
          console.log(`  Table ${rowSize}x${colSize} (large, cell-by-cell)`);
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
          block_type: BLOCK_TYPE.heading1,
          heading1: { style: {}, elements: [{ text_run: { content: title, text_element_style: {} } }] },
        },
        ...blocks,
      ];

  const tableCount = contentBlocks.filter(b => b.block_type === BLOCK_TYPE.table && b._table).length;
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
