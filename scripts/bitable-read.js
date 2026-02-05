import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiGet, fetchAllPaged } from '../api/feishu.js';
import { createSpinner } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

async function main() {
  const config = await readConfig();
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [appToken, tableId] = args;
  if (!appToken || !tableId) {
    console.error('Usage: npm run bitable-read <app_token> <table_id> [--json]');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);
  const jsonMode = process.argv.includes('--json');

  const spinner = createSpinner('Fetching fields...');
  spinner.start();

  const fieldsData = await apiGet(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    token, { page_size: 100 }
  );
  const fields = fieldsData.items || [];

  spinner.text = 'Fetching records...';
  const records = await fetchAllPaged(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    token, {}, { pageSize: 100 }
  );
  spinner.succeed(`${records.length} records fetched`);

  if (jsonMode) {
    console.log(JSON.stringify({ fields, records }, null, 2));
    return;
  }

  const fieldNames = fields.map(f => f.field_name);
  console.log(fieldNames.map(csvEscape).join(','));
  for (const rec of records) {
    const row = fieldNames.map(name => csvEscape(formatFieldValue(rec.fields?.[name])));
    console.log(row.join(','));
  }
}

function formatFieldValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    return val.map(v =>
      (typeof v === 'object' && v !== null) ? (v.text || v.name || JSON.stringify(v)) : String(v)
    ).join('; ');
  }
  if (typeof val === 'object') return val.text || val.name || JSON.stringify(val);
  return String(val);
}

function csvEscape(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
