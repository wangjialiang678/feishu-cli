import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, extractDocumentId } from '../api/helpers.js';
import {
  fetchDocumentMeta,
  fetchAllBlocks,
  uploadMarkdownToDocument,
  createDocument,
  appendBlocksWithTables,
} from '../api/feishu.js';
import { feishuToMarkdown, markdownToBlocks, BLOCK_TYPE } from '../api/feishu-md.js';
import { createSpinner } from './cli-utils.js';

function printUsage() {
  console.error(`Usage:
  Read mode (output Markdown to stdout):
    node scripts/beautify.js <doc-url-or-id>

  Write mode (write beautified Markdown back):
    node scripts/beautify.js <doc-url-or-id> --from <beautified.md>
    node scripts/beautify.js <doc-url-or-id> --from <beautified.md> --replace`);
}

function parseArgs(argv) {
  const args = { docInput: null, fromFile: null, replace: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--from' && i + 1 < argv.length) {
      args.fromFile = argv[i + 1];
      i += 2;
    } else if (arg === '--replace') {
      args.replace = true;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!args.docInput) {
      args.docInput = arg;
      i += 1;
    } else {
      i += 1;
    }
  }
  return args;
}

async function main() {
  const config = await readConfig();
  const args = parseArgs(process.argv);

  if (!args.docInput) {
    printUsage();
    process.exit(1);
  }

  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);
  const documentId = extractDocumentId(args.docInput);

  if (!args.fromFile) {
    // Read mode: fetch document and output Markdown to stdout
    const spinner = createSpinner('Reading document...').start();
    const metadata = await fetchDocumentMeta(documentId, token);
    const blocks = await fetchAllBlocks(documentId, token);
    spinner.succeed(`Read: ${metadata.title || documentId}`);

    const markdown = feishuToMarkdown({
      metadata: {
        document_id: documentId,
        revision_id: metadata.revision_id ?? metadata.revisionId ?? null,
        title: metadata.title || documentId,
      },
      blocks,
    });

    process.stdout.write(markdown);
    return;
  }

  // Write mode: read beautified Markdown and write back
  const inputPath = resolvePath(args.fromFile);
  const markdown = await fs.readFile(inputPath, 'utf8');
  const { title, blocks } = markdownToBlocks(markdown);

  if (args.replace) {
    // Overwrite original document
    const spinner = createSpinner('Overwriting document...').start();
    await uploadMarkdownToDocument(documentId, token, markdown);
    spinner.succeed('Document overwritten');
    console.log(`https://feishu.cn/docx/${documentId}`);
  } else {
    // Create new document
    const spinner = createSpinner('Creating new document...').start();
    const { documentId: newDocId, usedTitle } = await createDocument(token, title);

    const contentBlocks = usedTitle
      ? blocks
      : [
          {
            block_type: BLOCK_TYPE.heading1,
            heading1: { style: {}, elements: [{ text_run: { content: title, text_element_style: {} } }] },
          },
          ...blocks,
        ];

    await appendBlocksWithTables(newDocId, token, contentBlocks);
    spinner.succeed(`New document created: ${usedTitle || title}`);
    console.log(`https://feishu.cn/docx/${newDocId}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
