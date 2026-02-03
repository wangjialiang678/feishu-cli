import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { fetchWikiNodes } from '../api/feishu.js';
import { createSpinner } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

function formatNodeLine(node, indent) {
  const title = node.title || node.name || '(untitled)';
  const docToken = node.obj_token || node.objToken || '';
  return `${'  '.repeat(indent)}- ${title} ${docToken}`;
}

async function collectNodes(spaceId, token, parentNodeToken, indent, lines) {
  const nodes = await fetchWikiNodes(spaceId, token, parentNodeToken);
  for (const node of nodes) {
    lines.push(formatNodeLine(node, indent));
    const hasChild = node.has_child ?? node.hasChild;
    if (hasChild) {
      const nodeToken = node.node_token || node.nodeToken;
      if (nodeToken) {
        await collectNodes(spaceId, token, nodeToken, indent + 1, lines);
      }
    }
  }
}

async function main() {
  const config = await readConfig();
  const spaceId = requireConfigValue(config, 'wikiSpaceId');
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  const spinner = createSpinner('Loading wiki tree...').start();
  const lines = [];
  await collectNodes(spaceId, token, undefined, 0, lines);
  spinner.succeed(`${lines.length} nodes`);
  for (const line of lines) console.log(line);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
