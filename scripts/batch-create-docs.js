#!/usr/bin/env node
/**
 * 批量创建飞书文档并回写链接到多维表格
 *
 * 用法:
 *   npm run batch-create-docs -- <app_token> <table_id> \
 *     --name-field "姓名" \
 *     --link-field "插入飞书链接部分" \
 *     --doc-title "学员当日报告-{姓名}"
 *     [--template <markdown_file>]
 *
 * 参数:
 *   app_token        多维表格的 app_token
 *   table_id         数据表的 table_id
 *   --name-field     用于文档命名的字段名（必填）
 *   --link-field     回写文档链接的目标字段名（必填）
 *   --doc-title      文档标题模板，{字段名} 会被替换（可选，默认使用 name-field 值）
 *   --template       文档初始内容的 Markdown 文件路径（可选）
 */
import fs from 'node:fs/promises';
import { readConfig, requireConfigValue, resolvePath } from '../config.js';
import { readToken } from '../api/helpers.js';
import { apiPut, fetchAllPaged, createDocument, uploadMarkdownToDocument } from '../api/feishu.js';
import { createSpinner, createProgressBar } from './cli-utils.js';

if (typeof fetch !== 'function') {
  console.error('This CLI requires Node.js 18+ (global fetch).');
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

function extractText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.map(v =>
      (typeof v === 'object' && v !== null) ? (v.text || v.name || JSON.stringify(v)) : String(v)
    ).join('; ');
  }
  if (typeof val === 'object') return val.text || val.name || JSON.stringify(val);
  return String(val);
}

function buildTitle(template, record) {
  return template.replace(/\{([^}]+)\}/g, (_, key) => extractText(record.fields?.[key]) || key);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const [appToken, tableId] = positional;
  const nameField = flags['name-field'];
  const linkField = flags['link-field'];
  const titleTemplate = flags['doc-title'];
  const templatePath = flags['template'];

  if (!appToken || !tableId || !nameField || !linkField) {
    console.error('Usage: npm run batch-create-docs -- <app_token> <table_id> \\');
    console.error('  --name-field "姓名" --link-field "链接字段" [--doc-title "模板-{姓名}"] [--template file.md]');
    process.exit(1);
  }

  const config = await readConfig();
  const tokenPath = resolvePath(requireConfigValue(config, 'tokenPath'));
  const token = await readToken(tokenPath);

  // 读取模板内容（如有）
  let templateContent = null;
  if (templatePath) {
    templateContent = await fs.readFile(resolvePath(templatePath), 'utf8');
  }

  // 获取所有记录
  const spinner = createSpinner('Fetching records...');
  spinner.start();
  const records = await fetchAllPaged(
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    token, {}, { pageSize: 100 }
  );
  spinner.succeed(`${records.length} records fetched`);

  const bar = createProgressBar(records.length, 'Creating docs');
  let created = 0;
  let skipped = 0;

  for (const rec of records) {
    // 幂等：跳过已有链接的记录
    const existing = rec.fields?.[linkField];
    if (existing) {
      skipped++;
      bar.update(created + skipped);
      continue;
    }

    // 构建文档标题
    const name = extractText(rec.fields?.[nameField]);
    if (!name) {
      console.error(`\nWarning: record ${rec.record_id} has no value for "${nameField}", skipping`);
      skipped++;
      bar.update(created + skipped);
      continue;
    }

    const title = titleTemplate ? buildTitle(titleTemplate, rec) : name;

    // 创建文档
    const { documentId } = await createDocument(token, title);

    // 上传模板内容（如有）
    if (templateContent) {
      const content = buildTitle(templateContent, rec);
      await uploadMarkdownToDocument(documentId, token, content);
    }

    // 构建文档 URL 并回写到多维表格
    const docUrl = `https://feishu.cn/docx/${documentId}`;
    await apiPut(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${rec.record_id}`,
      token,
      { fields: { [linkField]: docUrl } }
    );

    created++;
    bar.update(created + skipped);
  }

  bar.stop();
  console.log(`Done: ${created} docs created, ${skipped} skipped (already had link or no name)`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
