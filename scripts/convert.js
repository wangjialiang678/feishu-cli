import fs from 'node:fs/promises';
import { feishuToMarkdown, markdownToFeishu } from '../api/feishu-md.js';

async function readInput(path) {
  if (!path || path === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFile(path, 'utf8');
}

function extractJson(text) {
  const idx = text.indexOf('{');
  if (idx === -1) {
    throw new Error('No JSON object found in input.');
  }
  const jsonText = text.slice(idx).trim();
  return JSON.parse(jsonText);
}

async function main() {
  const [mode, inputPath] = process.argv.slice(2);

  if (!mode || !['to-md', 'to-feishu'].includes(mode)) {
    console.error('Usage: npm run convert to-md <json-file|->');
    console.error('       npm run convert to-feishu <markdown-file|->');
    process.exit(1);
  }

  const input = await readInput(inputPath);

  if (mode === 'to-md') {
    const data = extractJson(input);
    const md = feishuToMarkdown(data);
    process.stdout.write(md);
    return;
  }

  const result = markdownToFeishu(input);
  process.stdout.write(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
