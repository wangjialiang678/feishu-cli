import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPost } from '../api/feishu.js';

const ERR_SEARCH_NO_PERMISSION = '99991672';
const ERR_SEARCH_NOT_ENABLED = '99991663';

async function main() {
  const config = await readConfig();
  const keyword = process.argv[2];
  if (!keyword) {
    console.error('Usage: node scripts/search.js <关键词> [--type docx|doc|sheet|bitable|folder]');
    process.exit(1);
  }

  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  // Parse optional --type flag
  let docsTypes = [];
  const typeIdx = process.argv.indexOf('--type');
  if (typeIdx !== -1 && process.argv[typeIdx + 1]) {
    docsTypes = process.argv[typeIdx + 1].split(',');
  }

  // Use suite/docs-api/search/object (supports user_access_token)
  const body = {
    search_key: keyword,
    count: 20,
    offset: 0,
  };
  if (docsTypes.length) {
    body.docs_types = docsTypes;
  }

  try {
    const data = await apiPost('/suite/docs-api/search/object', token, body) || {};
    const docs = data.docs_entities || [];

    if (!docs.length) {
      console.log(`没有找到包含 "${keyword}" 的文档`);
      return;
    }

    console.log(`找到 ${data.total || docs.length} 个结果（显示前 ${docs.length} 个）：\n`);

    for (const doc of docs) {
      const meta = doc.docs_token_info || {};
      const title = doc.title || '(无标题)';
      const type = meta.type || doc.docs_type || '?';
      const token_val = meta.token || doc.docs_token || '';
      const url = doc.url || (token_val ? `https://feishu.cn/docx/${token_val}` : '');
      const owner = doc.owner?.name || '';

      console.log(`  ${title}`);
      console.log(`    类型: ${type}  ${owner ? '作者: ' + owner : ''}`);
      if (url) console.log(`    URL: ${url}`);
      console.log();
    }
  } catch (err) {
    // Fallback: try newer API
    if (err.message.includes(ERR_SEARCH_NO_PERMISSION) || err.message.includes(ERR_SEARCH_NOT_ENABLED)) {
      console.error('搜索权限不足，请确认应用已开通 search 相关权限');
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
