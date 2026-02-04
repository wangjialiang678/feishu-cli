import { readFile } from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken, extractDocumentId } from '../api/helpers.js';
import { fetchDocumentMeta, fetchAllBlocks } from '../api/feishu.js';
import { feishuToMarkdown } from '../api/feishu-md.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extract text content from Markdown, stripping all formatting to produce a
// list of plain-text "content lines".  This makes comparison resilient to the
// many formatting differences introduced by the Feishu round-trip (HTML
// tables, list renumbering, blank lines, trailing spaces, bold links, etc.).
// ---------------------------------------------------------------------------

function extractTextLines(markdown) {
  const lines = markdown.split('\n');
  const result = [];

  for (let line of lines) {
    line = line.trimEnd();

    // Skip blank lines
    if (line.trim() === '') continue;

    // Skip horizontal rules
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) continue;

    // Skip HTML table structural tags (keep content in <td>/<th>)
    if (/^\s*<\/?(table|thead|tbody|tr)\s*>/.test(line)) continue;

    // Skip MD table separator rows: | --- | --- |
    if (/^\|[\s-:|]+\|$/.test(line.trim())) continue;

    // Strip HTML td/th tags, keep inner content
    line = line.replace(/<\/?t[dh][^>]*>/g, '');

    // Strip heading markers: ## Title → Title
    line = line.replace(/^#{1,9}\s+/, '');

    // Strip blockquote markers: > text → text
    line = line.replace(/^>\s*/, '');

    // Strip callout markers: [!NOTE] etc.
    if (/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]$/.test(line.trim())) continue;

    // Strip list markers: - item, * item, 1. item
    line = line.replace(/^\s*[-*]\s+/, '');
    line = line.replace(/^\s*\d+\.\s+/, '');

    // Strip inline formatting: **bold**, *italic*, ~~strike~~, `code`
    line = line.replace(/\*\*([^*]+)\*\*/g, '$1');
    line = line.replace(/\*([^*]+)\*/g, '$1');
    line = line.replace(/~~([^~]+)~~/g, '$1');
    line = line.replace(/`([^`]+)`/g, '$1');

    // Normalise links: [text](url) → text
    line = line.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');

    // Strip MD table cell delimiters: | cell | cell | → cell cell
    line = line.replace(/\|/g, ' ');

    // Collapse whitespace
    line = line.replace(/\s+/g, ' ').trim();

    // Skip if now empty
    if (line === '') continue;

    result.push(line);
  }

  return result;
}

// ---------------------------------------------------------------------------
// LCS-based diff — find lines present in local but missing from feishu, and
// vice versa.  This is tolerant of line reordering within sections.
// ---------------------------------------------------------------------------

function setDiff(localLines, feishuLines) {
  const feishuSet = new Set(feishuLines);
  const localSet = new Set(localLines);
  const feishuJoined = feishuLines.join(' ');
  const localJoined = localLines.join(' ');

  // A line is "missing" only if it's not in the set AND its content can't
  // be found in the joined full text (handles table cell splitting).
  const missingFromFeishu = localLines.filter(
    (l) => !feishuSet.has(l) && !feishuJoined.includes(l),
  );
  const extraInFeishu = feishuLines.filter(
    (l) => !localSet.has(l) && !localJoined.includes(l),
  );

  return { missingFromFeishu, extraInFeishu };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const docInput = process.argv[2];
  const localPath = process.argv[3];

  if (!docInput || !localPath) {
    console.error('Usage: node scripts/verify.js <doc-url-or-id> <local-md-file>');
    process.exit(1);
  }

  // Read local file
  const localRaw = await readFile(localPath, 'utf8');

  // Fetch Feishu document
  const config = await readConfig();
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const documentId = extractDocumentId(docInput);
  const token = await readToken(tokenPath);

  const metadata = await fetchDocumentMeta(documentId, token);
  const blocks = await fetchAllBlocks(documentId, token);
  const feishuRaw = feishuToMarkdown({
    metadata: {
      document_id: documentId,
      revision_id: metadata.revision_id ?? metadata.revisionId ?? null,
      title: metadata.title || documentId,
    },
    blocks,
  });

  // Extract text content
  const localLines = extractTextLines(localRaw);
  const feishuLines = extractTextLines(feishuRaw);

  const { missingFromFeishu, extraInFeishu } = setDiff(localLines, feishuLines);

  const totalLocal = localLines.length;
  const matchCount = totalLocal - missingFromFeishu.length;
  const matchPct = totalLocal > 0 ? ((matchCount / totalLocal) * 100).toFixed(1) : '100.0';

  if (missingFromFeishu.length === 0 && extraInFeishu.length === 0) {
    console.log(`✅ PASS  ${localPath}`);
    console.log(`   Document: ${metadata.title || documentId}`);
    console.log(`   Content lines: local ${totalLocal} / feishu ${feishuLines.length}`);
    console.log(`   Match: ${matchPct}%`);
    process.exit(0);
  }

  // Determine severity: a few missing lines may be acceptable (e.g. the
  // first H1 title becomes the doc title and is stripped from body).
  const severity = missingFromFeishu.length <= 2 && extraInFeishu.length <= 2 ? 'WARN' : 'FAIL';
  const icon = severity === 'WARN' ? '⚠️' : '❌';
  const exitCode = severity === 'WARN' ? 0 : 1;

  console.log(`${icon} ${severity}  ${localPath}`);
  console.log(`   Document: ${metadata.title || documentId}`);
  console.log(`   Content lines: local ${totalLocal} / feishu ${feishuLines.length}`);
  console.log(`   Match: ${matchPct}%`);

  if (missingFromFeishu.length > 0) {
    console.log(`\n   Missing from Feishu (${missingFromFeishu.length}):`);
    for (const line of missingFromFeishu.slice(0, 15)) {
      console.log(`     - ${line.substring(0, 120)}`);
    }
    if (missingFromFeishu.length > 15) {
      console.log(`     ... and ${missingFromFeishu.length - 15} more`);
    }
  }

  if (extraInFeishu.length > 0) {
    console.log(`\n   Extra in Feishu (${extraInFeishu.length}):`);
    for (const line of extraInFeishu.slice(0, 15)) {
      console.log(`     - ${line.substring(0, 120)}`);
    }
    if (extraInFeishu.length > 15) {
      console.log(`     ... and ${extraInFeishu.length - 15} more`);
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
