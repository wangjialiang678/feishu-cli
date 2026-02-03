import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, extractDocumentId } from '../api/helpers.js';
import { apiGet, fetchAllBlocks } from '../api/feishu.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

async function main() {
  const config = await readConfig();
  const docInput = process.argv[2];
  if (!docInput) {
    console.error('Usage: npm run fetch <doc-url-or-id>');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));

  const documentId = extractDocumentId(docInput);
  const token = await readToken(tokenPath);

  const documentInfo = await apiGet(`/docx/v1/documents/${documentId}`, token);
  const metadata = documentInfo.document || documentInfo;
  const blocks = await fetchAllBlocks(documentId, token);

  const output = {
    metadata,
    blocks,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
