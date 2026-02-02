import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { fetchDocumentMeta, fetchAllBlocks } from '../api/feishu.js';
import { feishuToMarkdown } from '../api/feishu-md.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

function extractDocumentId(input) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const cleaned = trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

async function main() {
  const config = await readConfig();
  const docInput = process.argv[2];
  if (!docInput) {
    console.error('Usage: node scripts/read.js <doc-url-or-id>');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));

  const documentId = extractDocumentId(docInput);
  const token = await readToken(tokenPath);

  const metadata = await fetchDocumentMeta(documentId, token);
  const blocks = await fetchAllBlocks(documentId, token);
  const markdown = feishuToMarkdown({
    metadata: {
      document_id: documentId,
      revision_id: metadata.revision_id ?? metadata.revisionId ?? null,
      title: metadata.title || documentId,
    },
    blocks,
  });

  process.stdout.write(markdown);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
