import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, sanitizeFilename } from '../api/helpers.js';
import { fetchDocumentMeta, downloadDocumentToFile } from '../api/feishu.js';

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
    console.error('Usage: npm run download <doc-url-or-id>');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));

  const documentId = extractDocumentId(docInput);
  const token = await readToken(tokenPath);

  const metadata = await fetchDocumentMeta(documentId, token);
  const title = metadata.title || documentId;
  const filename = `${sanitizeFilename(title) || documentId}.md`;
  await downloadDocumentToFile(
    documentId,
    token,
    {
      document_id: documentId,
      revision_id: metadata.revision_id ?? metadata.revisionId ?? null,
      title,
    },
    filename
  );
  console.log(`Saved ${filename}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
