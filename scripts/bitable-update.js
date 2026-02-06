import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPost, sleep, API_INTERVAL_MS } from '../api/feishu.js';
import { createSpinner, createProgressBar } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

const BATCH_SIZE = 500;

async function main() {
  const config = await readConfig();
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [appToken, tableId, csvPath] = args;
  if (!appToken || !tableId || !csvPath) {
    console.error('Usage: npm run bitable-update <app_token> <table_id> <csv_file>');
    console.error('  CSV must have a "record_id" column. Other columns are fields to update.');
    process.exit(1);
  }
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  const spinner = createSpinner('Reading CSV...');
  spinner.start();

  const csvContent = await fs.readFile(resolvePath(csvPath), 'utf8');
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    spinner.fail('CSV must have a header row and at least one data row.');
    process.exit(1);
  }

  const headers = rows[0];
  const ridIdx = headers.indexOf('record_id');
  if (ridIdx === -1) {
    spinner.fail('CSV must have a "record_id" column.');
    process.exit(1);
  }

  const dataRows = rows.slice(1);
  spinner.succeed(`${dataRows.length} rows parsed`);

  const bar = createProgressBar(dataRows.length, 'Updating');
  let updated = 0;

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    if (i > 0) await sleep(API_INTERVAL_MS);
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    const records = batch.map(row => {
      const fields = {};
      for (let c = 0; c < headers.length; c++) {
        if (c === ridIdx) continue;
        if (row[c] !== undefined && row[c] !== '') {
          fields[headers[c]] = row[c];
        }
      }
      return { record_id: row[ridIdx], fields };
    });

    await apiPost(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      token, { records }
    );
    updated += batch.length;
    bar.update(updated);
  }
  bar.stop();
  console.log(`Done: ${updated} records updated`);
}

// Minimal RFC 4180 CSV parser
function parseCSV(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++;
        let field = '';
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else { field += text[i]; i++; }
        }
        row.push(field);
      } else {
        let field = '';
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i]; i++;
        }
        row.push(field);
      }
      if (i < text.length && text[i] === ',') { i++; }
      else break;
    }
    if (i < text.length && text[i] === '\r') i++;
    if (i < text.length && text[i] === '\n') i++;
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }
  return rows;
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
