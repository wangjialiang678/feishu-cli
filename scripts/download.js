import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, sanitizeFilename, extractDocumentId } from '../api/helpers.js';
import { fetchDocumentMeta, downloadDocumentToFile } from '../api/feishu.js';
import { createSpinner } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
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

  const spinner = createSpinner('Fetching document...').start();
  const metadata = await fetchDocumentMeta(documentId, token);
  const title = metadata.title || documentId;
  const filename = `${sanitizeFilename(title) || documentId}.md`;
  spinner.text = `Downloading "${title}"...`;
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
  spinner.succeed(`Saved ${filename}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
