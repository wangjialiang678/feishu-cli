import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiGet } from '../api/feishu.js';
import { createSpinner } from './cli-utils.js';

async function main() {
  const config = await readConfig();
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [appToken, tableId] = args;
  if (!appToken || !tableId) {
    console.error('Usage: npm run bitable-fields <app_token> <table_id> [--json]');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  const spinner = createSpinner('Fetching fields...');
  spinner.start();

  const data = await apiGet(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    token,
    { page_size: 100 }
  );
  const fields = data.items || [];
  spinner.stop();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(fields, null, 2));
  } else {
    console.log('field_name\ttype\tfield_id');
    for (const f of fields) {
      console.log(`${f.field_name}\t${f.type}\t${f.field_id}`);
    }
    console.error(`\n${fields.length} fields`);
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
