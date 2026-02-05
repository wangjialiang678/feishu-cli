#!/usr/bin/env node
/**
 * 向已有飞书文档追加链接
 *
 * 用法:
 *   npm run append-link -- <文档URL或ID> <链接URL> [显示文本]
 */
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, extractDocumentId } from '../api/helpers.js';
import { appendBlocks, fetchChildrenCount } from '../api/feishu.js';
import { createSpinner } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [docInput, linkUrl, linkText] = args;

  if (!docInput || !linkUrl) {
    console.error('Usage: npm run append-link -- <文档URL或ID> <链接URL> [显示文本]');
    process.exit(1);
  }

  const documentId = extractDocumentId(docInput);
  const displayText = linkText || linkUrl;

  const config = await readConfig();
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  const spinner = createSpinner('Appending link...');
  spinner.start();

  // 获取当前子块数量，用作追加位置
  const childCount = await fetchChildrenCount(documentId, token);

  const block = {
    block_type: 2, // text
    text: {
      elements: [
        {
          text_run: {
            content: displayText,
            text_element_style: {
              link: { url: encodeURIComponent(linkUrl) },
            },
          },
        },
      ],
      style: {},
    },
  };

  await appendBlocks(documentId, token, [block], childCount);
  spinner.succeed(`Link appended: ${displayText} → ${linkUrl}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
