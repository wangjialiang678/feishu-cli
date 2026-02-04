#!/usr/bin/env node
/**
 * 飞书文档权限管理工具
 *
 * 用法:
 *   node scripts/doc-permission.js get <文档URL或ID> [--type docx]
 *   node scripts/doc-permission.js set <文档URL或ID...> --preset public|tenant|private|editable
 *   node scripts/doc-permission.js set <文档URL或ID...> --link-share anyone_readable --external open
 *   node scripts/doc-permission.js add <文档URL或ID> --member <openid|email> --perm view|edit|full_access
 *   node scripts/doc-permission.js list <文档URL或ID> [--type docx]
 *
 * 预设:
 *   public   — 互联网任何人可通过链接阅读
 *   tenant   — 仅组织内成员可通过链接阅读
 *   private  — 仅协作者可访问（关闭链接分享）
 *   editable — 互联网任何人可通过链接编辑
 */
import { apiRequest } from '../api/feishu.js';
import { readToken, extractDocumentId } from '../api/helpers.js';
import { readConfig } from '../config.js';

// ── 预设权限方案 ──────────────────────────────────────────────
const PRESETS = {
  public: {
    desc: '互联网任何人可通过链接阅读',
    body: {
      external_access_entity: 'anyone_can_view',
      link_share_entity: 'anyone_readable',
    },
  },
  tenant: {
    desc: '仅组织内成员可通过链接阅读',
    body: {
      external_access_entity: 'only_tenant_can_view',
      link_share_entity: 'tenant_readable',
    },
  },
  private: {
    desc: '仅协作者可访问（关闭链接分享）',
    body: {
      link_share_entity: 'closed',
    },
  },
  editable: {
    desc: '互联网任何人可通过链接编辑',
    body: {
      external_access_entity: 'anyone_can_view',
      link_share_entity: 'anyone_editable',
    },
  },
};

// ── 可设置的字段说明 ──────────────────────────────────────────
const FIELD_HELP = `
可设置字段（用 --字段名 值 方式指定）:
  --external-access     外部访问: open | closed | allow_share_partner_tenant
  --link-share          链接分享: anyone_readable | anyone_editable | tenant_readable | tenant_editable | closed
  --security            谁可管理: anyone_can_view | anyone_can_edit | only_full_access
  --comment             谁可评论: anyone_can_view | anyone_can_edit
  --share               谁可分享: anyone | same_tenant | only_full_access
  --invite-external     允许邀请外部人: true | false
  --lock                锁定设置: true | false
  --copy                谁可复制: anyone_can_view | anyone_can_edit | only_full_access
`;

// ── 字段名映射（CLI flag → API field）──────────────────────
const FIELD_MAP = {
  'external-access': 'external_access_entity',
  'external': 'external_access_entity',
  'link-share': 'link_share_entity',
  'link': 'link_share_entity',
  'security': 'security_entity',
  'comment': 'comment_entity',
  'share': 'share_entity',
  'invite-external': 'invite_external',
  'lock': 'lock_switch',
  'copy': 'copy_entity',
};

// ── 帮助信息 ─────────────────────────────────────────────────
function showHelp() {
  console.log(`飞书文档权限管理工具

用法:
  node scripts/doc-permission.js get  <文档URL或ID>              查看当前权限
  node scripts/doc-permission.js set  <文档URL或ID...> [选项]     设置权限（支持批量）
  node scripts/doc-permission.js add  <文档URL或ID> [选项]        添加协作者
  node scripts/doc-permission.js list <文档URL或ID>              列出协作者

set 命令选项:
  --preset <名称>     使用预设方案: public | tenant | private | editable
  --type <类型>       文档类型 (默认 docx): docx | doc | sheet | bitable | folder
${FIELD_HELP}
add 命令选项:
  --member <ID>       成员标识 (open_id, union_id, email 等)
  --member-type <类型> 成员类型 (默认 openid): openid | unionid | email | chat | department
  --perm <权限>       权限级别: view | edit | full_access

预设方案:
  public   — ${PRESETS.public.desc}
  tenant   — ${PRESETS.tenant.desc}
  private  — ${PRESETS.private.desc}
  editable — ${PRESETS.editable.desc}

示例:
  # 查看权限
  node scripts/doc-permission.js get https://feishu.cn/docx/xxxxx

  # 批量设为公开可读
  node scripts/doc-permission.js set url1 url2 url3 --preset public

  # 自定义权限
  node scripts/doc-permission.js set url1 --link-share tenant_readable --external closed

  # 添加协作者
  node scripts/doc-permission.js add url1 --member user@example.com --member-type email --perm edit
`);
}

// ── 参数解析 ─────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return { action: 'help' };
  }

  const action = args[0];
  const docs = [];
  const flags = {};

  let i = 1;
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] || '';
      flags[key] = value;
      i += 2;
    } else {
      docs.push(args[i]);
      i += 1;
    }
  }

  return { action, docs, flags };
}

// ── 格式化权限显示 ──────────────────────────────────────────
function formatPermission(data) {
  const p = data.permission_public || data;
  const lines = [];
  if (p.external_access !== undefined) lines.push(`  外部访问        ${p.external_access ? '✅ 允许' : '❌ 禁止'}`);
  if (p.link_share_entity) lines.push(`  链接分享        ${p.link_share_entity}`);
  if (p.security_entity) lines.push(`  安全设置        ${p.security_entity}`);
  if (p.comment_entity) lines.push(`  评论权限        ${p.comment_entity}`);
  if (p.share_entity) lines.push(`  分享权限        ${p.share_entity}`);
  if (p.invite_external !== undefined) lines.push(`  邀请外部人      ${p.invite_external ? '✅ 允许' : '❌ 禁止'}`);
  if (p.lock_switch !== undefined) lines.push(`  锁定设置        ${p.lock_switch ? '🔒 已锁定' : '🔓 未锁定'}`);
  return lines.join('\n');
}

// ── 主逻辑 ───────────────────────────────────────────────────
const config = await readConfig();
const token = await readToken(config.tokenPath || './user-token.txt');
const { action, docs, flags } = parseArgs(process.argv);

if (action === 'help') {
  showHelp();
  process.exit(0);
}

const fileType = flags.type || 'docx';

// ── GET: 查看权限 ──────────────────────────────────────────
if (action === 'get') {
  if (docs.length === 0) {
    console.error('错误: 请提供文档 URL 或 ID');
    process.exit(1);
  }
  for (const doc of docs) {
    const docToken = extractDocumentId(doc);
    try {
      const res = await apiRequest('GET', `/drive/v1/permissions/${docToken}/public`, token, {
        query: { type: fileType },
      });
      console.log(`📄 ${docToken}`);
      console.log(formatPermission(res));
      console.log();
    } catch (err) {
      console.error(`❌ ${docToken}: ${err.message}`);
    }
  }
}

// ── SET: 设置权限 ──────────────────────────────────────────
else if (action === 'set') {
  if (docs.length === 0) {
    console.error('错误: 请提供至少一个文档 URL 或 ID');
    process.exit(1);
  }

  // 构建请求体
  let body = {};

  if (flags.preset) {
    const preset = PRESETS[flags.preset];
    if (!preset) {
      console.error(`错误: 未知预设 "${flags.preset}"。可选: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    body = { ...preset.body };
    console.log(`使用预设: ${flags.preset} — ${preset.desc}`);
  }

  // 自定义字段覆盖预设
  for (const [key, value] of Object.entries(flags)) {
    if (key === 'preset' || key === 'type') continue;
    const apiField = FIELD_MAP[key];
    if (!apiField) {
      console.error(`警告: 未知字段 "--${key}"，已跳过`);
      continue;
    }
    // 布尔值转换
    if (value === 'true') body[apiField] = true;
    else if (value === 'false') body[apiField] = false;
    else body[apiField] = value;
  }

  if (Object.keys(body).length === 0) {
    console.error('错误: 请指定 --preset 或至少一个权限字段');
    console.error('运行 node scripts/doc-permission.js --help 查看帮助');
    process.exit(1);
  }

  const docTokens = docs.map((d) => extractDocumentId(d));

  // 并行处理所有文档
  const results = await Promise.allSettled(
    docTokens.map(async (docToken) => {
      await apiRequest('PATCH', `/drive/v1/permissions/${docToken}/public`, token, {
        query: { type: fileType },
        body,
      });
      return docToken;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      console.log(`✅ ${result.value}`);
    } else {
      console.log(`❌ ${result.reason.message || result.reason}`);
    }
  }

  const success = results.filter((r) => r.status === 'fulfilled').length;
  console.log(`\n完成: ${success}/${results.length} 个文档已更新`);
}

// ── ADD: 添加协作者 ─────────────────────────────────────────
else if (action === 'add') {
  if (docs.length === 0) {
    console.error('错误: 请提供文档 URL 或 ID');
    process.exit(1);
  }
  if (!flags.member) {
    console.error('错误: 请使用 --member 指定成员标识');
    process.exit(1);
  }

  const memberType = flags['member-type'] || 'openid';
  const perm = flags.perm || 'view';
  const docToken = extractDocumentId(docs[0]);

  try {
    const res = await apiRequest('POST', `/drive/v1/permissions/${docToken}/members`, token, {
      query: { type: fileType, need_notification: 'true' },
      body: {
        member_type: memberType,
        member_id: flags.member,
        perm,
      },
    });
    console.log(`✅ 已添加协作者 ${flags.member} (${perm}) 到 ${docToken}`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

// ── LIST: 列出协作者 ────────────────────────────────────────
else if (action === 'list') {
  if (docs.length === 0) {
    console.error('错误: 请提供文档 URL 或 ID');
    process.exit(1);
  }
  const docToken = extractDocumentId(docs[0]);
  try {
    const res = await apiRequest('GET', `/drive/v1/permissions/${docToken}/members`, token, {
      query: { type: fileType },
    });
    const members = res.members || [];
    if (members.length === 0) {
      console.log('暂无协作者');
    } else {
      console.log(`📄 ${docToken} 的协作者 (${members.length} 人):\n`);
      for (const m of members) {
        const name = m.name || m.member_id || '未知';
        console.log(`  ${m.perm.padEnd(12)} ${m.member_type.padEnd(8)} ${name}`);
      }
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}

// ── 未知命令 ────────────────────────────────────────────────
else {
  console.error(`未知命令: ${action}`);
  showHelp();
  process.exit(1);
}
