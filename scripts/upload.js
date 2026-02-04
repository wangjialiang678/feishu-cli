import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPost, createDocument, buildTableDescendants, calculateColumnWidths, buildCalloutDescendants, buildQuoteContainerDescendants } from '../api/feishu.js';
import { markdownToBlocks, BLOCK_TYPE } from '../api/feishu-md.js';
import { createSpinner, createProgressBar } from './cli-utils.js';

const BATCH_SIZE = 50;

function isRetryableError(err) {
  const msg = err.message || '';
  return msg.includes('429') || msg.includes('rate limited') || msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
}

/**
 * Pre-validate Markdown content for potential upload issues
 * @param {string} content - Markdown content
 * @returns {Array<string>} - Array of warning messages
 */
function validateMarkdown(content) {
  const warnings = [];

  // Check for relative path links
  const relativePaths = [...content.matchAll(/\[([^\]]+)\]\((?!https?:\/\/|#)([^)]+)\)/g)];
  if (relativePaths.length > 0) {
    warnings.push(
      `⚠️  Found ${relativePaths.length} relative path link(s) - these may fail on Feishu:`
    );
    relativePaths.slice(0, 3).forEach(match => {
      warnings.push(`    - [${match[1]}](${match[2]})`);
    });
    if (relativePaths.length > 3) {
      warnings.push(`    ... and ${relativePaths.length - 3} more`);
    }
  }

  // Check for nested inline syntax (bold wrapping links)
  const nestedBold = content.match(/\*\*\[[^\]]+\]\([^)]+\)\*\*/g);
  if (nestedBold) {
    warnings.push(
      `⚠️  Found ${nestedBold.length} bold-wrapped link(s) - not supported by feishu-cli`
    );
    warnings.push('    Fix: Remove ** markers or split into separate elements');
  }

  // Check for nested inline syntax (bold wrapping code)
  const nestedCode = content.match(/\*\*`[^`]+`\*\*/g);
  if (nestedCode) {
    warnings.push(
      `⚠️  Found ${nestedCode.length} bold-wrapped code span(s) - not supported by feishu-cli`
    );
    warnings.push('    Fix: Remove ** markers or split into separate elements');
  }

  return warnings;
}

async function uploadBlocks(docId, token, blocks, onProgress) {
  let pending = [];
  let added = 0, failed = 0;

  const flush = async () => {
    if (!pending.length) return;
    const toFlush = pending;
    pending = [];
    for (let i = 0; i < toFlush.length; i += BATCH_SIZE) {
      const chunk = toFlush.slice(i, i + BATCH_SIZE);
      try {
        await apiPost(`/docx/v1/documents/${docId}/blocks/${docId}/children`, token, { children: chunk });
        added += chunk.length;
        if (onProgress) onProgress(chunk.length);
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
        }
      }
    }
  };

  for (const block of blocks) {
    if (block.block_type === BLOCK_TYPE.table && block._table) {
      await flush();
      const rows = block._table.rows;
      const rowSize = rows.length;
      const colSize = block.table?.property?.column_size || rows[0]?.length || 1;

      const columnWidth = calculateColumnWidths(rows, colSize);

      try {
        const { tableId, descendants } = buildTableDescendants(rows, colSize, columnWidth);
        await apiPost(
          `/docx/v1/documents/${docId}/blocks/${docId}/descendant`,
          token,
          { children_id: [tableId], descendants },
          { document_revision_id: -1 },
        );
        added += 1;
        if (onProgress) onProgress(1);
      } catch (err) {
        console.error(`  Table failed: ${err.message}`);
        failed += 1;
      }
    } else if (block.block_type === BLOCK_TYPE.callout && block._callout_children) {
      await flush();
      try {
        const { calloutId, descendants } = buildCalloutDescendants(block);
        await apiPost(
          `/docx/v1/documents/${docId}/blocks/${docId}/descendant`,
          token,
          { children_id: [calloutId], descendants },
          { document_revision_id: -1 },
        );
        added += 1;
        if (onProgress) onProgress(1);
      } catch (err) {
        console.error(`  Callout failed: ${err.message}`);
        failed += 1;
      }
    } else if (block.block_type === BLOCK_TYPE.quote_container && block._quote_children) {
      await flush();
      try {
        const { quoteId, descendants } = buildQuoteContainerDescendants(block);
        await apiPost(
          `/docx/v1/documents/${docId}/blocks/${docId}/descendant`,
          token,
          { children_id: [quoteId], descendants },
          { document_revision_id: -1 },
        );
        added += 1;
        if (onProgress) onProgress(1);
      } catch (err) {
        console.error(`  Quote failed: ${err.message}`);
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

  // Pre-validate markdown content
  const warnings = validateMarkdown(markdown);
  if (warnings.length > 0) {
    console.log('\n📋 Pre-upload validation warnings:\n');
    warnings.forEach(w => console.log(w));
    console.log('\nℹ️  These issues may cause upload failures or incorrect rendering.');
    console.log('   Proceeding anyway...\n');
  }

  const spinner = createSpinner('Parsing markdown...').start();
  const { title, blocks } = markdownToBlocks(markdown);
  spinner.text = 'Creating document...';
  const { documentId, usedTitle } = await createDocument(token, title);
  spinner.succeed(`Document created: ${usedTitle || title}`);

  const contentBlocks = usedTitle
    ? blocks
    : [
        {
          block_type: BLOCK_TYPE.heading1,
          heading1: { style: {}, elements: [{ text_run: { content: title, text_element_style: {} } }] },
        },
        ...blocks,
      ];

  const bar = createProgressBar(contentBlocks.length, 'Uploading');
  const { added, failed } = await uploadBlocks(documentId, token, contentBlocks, (n) => bar.increment(n));
  bar.stop();
  console.log(`Done: ${added} added, ${failed} failed`);
  console.log(`https://feishu.cn/docx/${documentId}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
