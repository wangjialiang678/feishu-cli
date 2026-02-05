# feishu-cli

飞书文档 CLI 工具 — 以用户身份（OAuth 2.0）上传/下载 Markdown 与飞书文档。

**特别致谢：[酸黄瓜](https://github.com/TMBMode/)**

## 功能

- **上传** — 本地 Markdown 文件 → 飞书文档（支持标题、段落、列表、代码块、引用、待办、表格、分割线、内联格式）
- **下载** — 飞书文档 → 本地 Markdown 文件
- **读取** — 飞书文档内容直接输出为 Markdown（不写本地文件）
- **搜索** — 按关键词搜索飞书文档，支持类型过滤
- **多维表格** — 查看字段、导出 CSV、从 CSV 导入、批量更新已有记录（Bitable API）
- **批量创建文档** — 从多维表格读取记录，批量创建飞书文档并回写链接
- **追加链接** — 向已有飞书文档末尾追加链接
- **美化** — 读取飞书文档 → AI 美化 Markdown → 回写（新建或覆盖原文档）
- **高亮块** — 支持 `> [!NOTE]` / `> [!TIP]` / `> [!WARNING]` / `> [!IMPORTANT]` 语法
- **权限管理** — 查看/设置文档分享权限、管理协作者（支持批量操作和预设方案）
- **离线转换** — Markdown ↔ 飞书 Block JSON 互转
- **列出文档** — 列出 Wiki 空间文档树
- **查看元数据** — 获取文档 ID、标题、版本号

## 核心特点

- 使用 **OAuth 2.0 user_access_token**（用户身份），而非 tenant_access_token（机器人身份）
- 上传的文档归用户所有，用户可直接编辑和搜索
- 无自动同步、无 WebSocket，纯 CLI 按需操作

---

## 快速开始

### 1. 安装依赖

```bash
cd ~/projects/feishu-cli
npm install
```

需要 Node.js 18+（使用全局 fetch API）。

### 2. 配置飞书应用

#### 2.1 创建或复用飞书应用

登录 [飞书开放平台](https://open.feishu.cn/app)，创建一个自建应用（或使用已有应用）。

#### 2.2 获取应用凭证

在应用详情页 → **凭证与基础信息** 中找到：
- **App ID**（格式 `cli_xxxx`）
- **App Secret**

#### 2.3 启用网页应用能力

左侧菜单 → **应用能力** → **网页应用** → 开启。
- 桌面端主页/移动端主页：随便填 `http://localhost:7777`（仅占位用）

#### 2.4 配置 OAuth 重定向 URL

左侧菜单 → **安全设置** → **重定向 URL** → 添加：

```
http://localhost:7777/callback
```

#### 2.5 添加权限范围

左侧菜单 → **权限管理** → 搜索并开通以下权限：

| 权限 | 说明 |
|------|------|
| `docx:document` | 读写文档 |
| `docs:doc` | 读写旧版文档 |
| `drive:drive` | 读写云空间文件 |
| `wiki:wiki` | 读写知识库 |
| `bitable:bitable` | 读写多维表格（Bitable 功能需要） |
| `offline_access` | 获取 refresh_token |

#### 2.6 发布应用版本

**重要**：权限修改后需要创建版本并发布才能生效。
左侧菜单 → **版本管理与发布** → 创建版本 → 申请发布 → 审核通过后生效。

### 3. 创建配置文件

在 Claude Code 中输入：

```
帮我创建 feishu-cli 的 config.json，App ID 是 cli_xxx，App Secret 是 yyy
```

Claude Code 会自动基于 `config.example.json` 生成配置文件。

也可以手动创建：

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的应用凭证：

```json
{
  "tokenPath": "./user-token.txt",
  "wikiSpaceId": "",
  "auth": {
    "clientId": "cli_你的AppID",
    "clientSecret": "你的AppSecret"
  }
}
```

- `tokenPath` — OAuth token 存储位置（自动写入，不用手动填）
- `wikiSpaceId` — 如需上传到 Wiki，填写 Wiki 空间 ID（可选）

> **注意**：`config.json` 包含敏感凭证，已在 `.gitignore` 中排除，不会被提交到 git。

### 4. OAuth 授权

```bash
npm run auth
```

浏览器会打开飞书授权页面，登录并同意授权后，token 自动写入 `user-token.txt`。

**注意**：auth 进程会持续运行以自动刷新 token（access_token 有效期 2 小时）。建议在单独终端中保持运行。如果 auth 停止，已有 token 在过期前仍可使用。

---

## 命令参考

### 上传 Markdown 到飞书

```bash
npm run upload -- <文件路径>
# 或
node scripts/upload.js <文件路径>
```

将本地 `.md` 文件上传为飞书文档，输出文档 URL。

- 第一个 `# 标题` 会被用作文档标题
- 支持表格（Markdown 表格 → 飞书表格块）
- 批量上传 50 个块一批，失败时自动二分法定位跳过坏块
- 表格使用 Batch Descendants API 一次性创建（≤9 行），大表格自动回退逐 cell 填充
- 列宽根据内容自动计算，支持 CJK 字符双倍宽度

### 下载飞书文档

```bash
npm run download -- <飞书文档URL或ID>
# 或
node scripts/download.js <飞书文档URL或ID>
```

将飞书文档下载为本地 Markdown 文件，保存在当前目录。

示例：
```bash
npm run download -- https://feishu.cn/docx/xxxxx
npm run download -- xxxxx
```

### 读取飞书文档内容

```bash
node scripts/read.js <飞书文档URL或ID>
```

将飞书文档内容以 Markdown 格式直接输出到 stdout，不创建本地文件。适用于只需读取内容的场景（如总结、问答、管道处理）。

示例：
```bash
node scripts/read.js https://feishu.cn/docx/xxxxx
node scripts/read.js xxxxx | head -20
```

### 查看文档元数据

```bash
npm run fetch -- <飞书文档URL或ID>
```

输出文档的 Block JSON 结构。

### 列出 Wiki 文档

```bash
npm run list
```

需要在 config.json 中配置 `wikiSpaceId`。

### 搜索飞书文档

```bash
npm run search -- <关键词> [--type docx|doc|sheet|bitable|folder]
# 或
node scripts/search.js <关键词> [--type docx|doc|sheet|bitable|folder]
```

按关键词搜索用户有权限访问的飞书文档，返回标题、类型和 URL。

- 支持 `--type` 过滤文档类型（多个类型用逗号分隔）
- 默认返回前 20 个结果

示例：
```bash
npm run search -- FAQ
npm run search -- 周报 --type docx
```

### 美化飞书文档

三步工作流：读取 → AI 美化 → 回写。

**步骤 1：读取文档为 Markdown**

```bash
node scripts/beautify.js <飞书文档URL或ID> > original.md
```

**步骤 2：AI 美化**（在 Claude Code 或其他工具中完成）

读取 `original.md`，根据以下原则重新组织：
- 添加合适的标题层级（`##` / `###`）
- 将零散内容组织为列表（`-` 或 `1.`）
- 适合的数据转为表格
- 重要信息用高亮块标注（`> [!NOTE]` / `> [!TIP]` / `> [!WARNING]` / `> [!IMPORTANT]`）
- 清理多余空行和格式混乱

保存美化后的内容到 `beautified.md`。

**步骤 3：回写到飞书**

```bash
# 创建新文档（安全，保留原文档）
node scripts/beautify.js <原文档URL> --from beautified.md

# 覆盖原文档
node scripts/beautify.js <原文档URL> --from beautified.md --replace
```

### 权限管理

查看文档当前权限：
```bash
npm run doc-permission -- get <飞书文档URL或ID>
```

批量设置权限（使用预设）：
```bash
# 预设方案: public（公开可读）、tenant（组织内可读）、private（仅协作者）、editable（公开可编辑）
npm run doc-permission -- set <URL1> <URL2> ... --preset public
```

自定义权限字段：
```bash
npm run doc-permission -- set <URL> --link-share tenant_readable --external closed
```

添加协作者：
```bash
npm run doc-permission -- add <URL> --member user@example.com --member-type email --perm edit
```

列出协作者：
```bash
npm run doc-permission -- list <URL>
```

查看完整帮助：
```bash
npm run doc-permission -- --help
```

支持的预设方案：

| 预设 | 说明 |
|------|------|
| `public` | 互联网任何人可通过链接阅读 |
| `tenant` | 仅组织内成员可通过链接阅读 |
| `private` | 仅协作者可访问（关闭链接分享） |
| `editable` | 互联网任何人可通过链接编辑 |

### 多维表格（Bitable）操作

查看表格字段：
```bash
npm run bitable-fields -- <app_token> <table_id>
npm run bitable-fields -- <app_token> <table_id> --json
```

导出全部记录为 CSV：
```bash
npm run bitable-read -- <app_token> <table_id> > output.csv
npm run bitable-read -- <app_token> <table_id> --json
```

从 CSV 导入记录：
```bash
npm run bitable-write -- <app_token> <table_id> data.csv
```

从 CSV 批量更新已有记录：
```bash
npm run bitable-update -- <app_token> <table_id> update.csv
```

- CSV 必须包含 `record_id` 列，其余列为要更新的字段
- `record_id` 可通过 `bitable-read --json` 导出获取

批量创建文档并回写链接：
```bash
npm run batch-create-docs -- <app_token> <table_id> \
  --name-field "姓名" \
  --link-field "文档链接" \
  --doc-title "学员报告-{姓名}"
```

- `--name-field` — 用于文档命名的字段（必填）
- `--link-field` — 回写文档 URL 的目标字段（必填）
- `--doc-title` — 标题模板，`{字段名}` 会被替换（可选）
- `--template` — 文档初始内容的 Markdown 模板文件（可选）
- 已有链接的记录会自动跳过（幂等，可安全重跑）

向已有文档追加链接：
```bash
npm run append-link -- <文档URL或ID> <链接URL> [显示文本]
```

- `app_token` 和 `table_id` 可从多维表格 URL 中获取：`https://feishu.cn/base/<app_token>?table=<table_id>`
- 导出 CSV 通过 stdout 输出，可直接重定向到文件
- 导入时 CSV 首行为表头（需与字段名匹配），每批 500 条
- 需要额外权限：`bitable:bitable`（在飞书开放平台添加）

### 验证上传结果

```bash
node scripts/verify.js <飞书文档URL或ID> <本地MD文件路径>
```

比对飞书文档与本地源文件的内容一致性。自动忽略已知格式差异（链接形式、列表编号、空行），输出 PASS/FAIL 及差异详情。

### 离线格式转换

```bash
npm run convert to-md <json文件或->     # Block JSON → Markdown
npm run convert to-feishu <md文件或->    # Markdown → Block JSON
```

支持管道输入（`-` 表示 stdin）。

---

## 支持的 Markdown 格式

| Markdown 语法 | 飞书块类型 |
|--------------|-----------|
| `# ~ #########` | heading1 ~ heading9 |
| 普通段落 | text |
| `- 列表` | bullet |
| `1. 列表` | ordered |
| `` ```code``` `` | code |
| `> 引用` | quote |
| `- [ ] / - [x]` | todo |
| `---` | divider |
| `\| 表格 \|` | table（创建 + 填充 cell） |
| `> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!IMPORTANT]` | callout（高亮块） |
| `**粗体**` `*斜体*` `` `代码` `` `[链接](url)` `~~删除线~~` | 内联格式 |

### 高亮块（Callout）语法

上传和美化时支持 GitHub/Obsidian 风格的高亮块：

```markdown
> [!NOTE]
> 蓝色背景的提示信息

> [!TIP]
> 绿色背景的技巧

> [!WARNING]
> 橙色背景的警告

> [!IMPORTANT]
> 红色背景的重要信息
```

也支持同行写法：`> [!NOTE] 这是提示内容`

### 已知限制

- 图片暂不支持（需额外文件上传权限）
- 含特殊 Unicode 字符（如 box-drawing ┌─┐）的代码块可能被跳过
- 嵌套列表会被展平为同级

---

## 项目结构

```
feishu-cli/
├── config.js              # 配置加载
├── config.json            # 你的配置（.gitignore 中，不提交）
├── config.example.json    # 配置模板
├── package.json
├── user-token.txt         # OAuth token（自动生成，不提交）
├── api/
│   ├── feishu.js          # 飞书 API 封装（文档 CRUD、Wiki 操作、表格工具函数）
│   ├── feishu-md.js       # Markdown ↔ 飞书 Block JSON 转换器
│   └── helpers.js         # Token 读取、文件名清理、文档 ID 解析等工具函数
├── scripts/
│   ├── auth.js            # OAuth 2.0 授权 + token 自动刷新
│   ├── upload.js          # 上传 Markdown → 飞书文档
│   ├── download.js        # 下载飞书文档 → Markdown
│   ├── read.js            # 读取飞书文档内容输出 Markdown（不写文件）
│   ├── search.js          # 按关键词搜索飞书文档
│   ├── fetch.js           # 查看文档元数据 + Block JSON
│   ├── list.js            # 列出 Wiki 空间文档
│   ├── beautify.js        # 美化飞书文档（读取/回写）
│   ├── doc-permission.js  # 文档权限管理（查看/设置/协作者）
│   ├── verify.js          # 上传验证（比对飞书文档与本地源文件）
│   ├── convert.js         # 离线 Markdown ↔ Block JSON 转换
│   ├── bitable-fields.js  # 查看多维表格字段结构
│   ├── bitable-read.js    # 导出多维表格记录为 CSV/JSON
│   ├── bitable-write.js   # 从 CSV 导入记录到多维表格
│   ├── bitable-update.js  # 从 CSV 批量更新已有记录
│   ├── batch-create-docs.js # 批量创建文档并回写链接到多维表格
│   ├── append-link.js     # 向已有文档追加链接
│   └── cli-utils.js       # 共享 CLI 工具（spinner、progress bar）
├── test/
│   └── feishu-md.test.js  # Markdown ↔ Block JSON 转换单元测试
└── docs/
    ├── technical.md       # 技术架构文档
    ├── comparison-with-feishufs.md  # 与 FeishuFS 项目对比
    └── research/          # 技术调研报告
```

---

## 在新电脑上部署

### 🤖 自动化部署（推荐）

如果使用 Claude Code，可以一键完成全部部署流程：

```
帮我下载 GitHub 项目并完成自动部署
```

Claude Code 会按照 [DEPLOYMENT.md](DEPLOYMENT.md) 自动执行：
- ✅ 克隆项目 + 安装依赖
- ✅ 配置飞书应用凭证
- ✅ 部署全局 feishu-doc Skill
- ✅ 运行 OAuth 授权
- ✅ 验证部署成功

详细部署流程和错误处理见 [DEPLOYMENT.md](DEPLOYMENT.md)。

### 手动部署步骤

1. 克隆仓库：
   ```bash
   git clone <repo-url> ~/projects/feishu-cli
   cd ~/projects/feishu-cli
   npm install
   ```

2. 创建配置（在 Claude Code 中输入）：
   ```
   帮我创建 feishu-cli 的 config.json，App ID 是 cli_xxx，App Secret 是 yyy
   ```
   或手动：`cp config.example.json config.json` 并编辑填入凭证。

3. 授权：
   ```bash
   npm run auth
   # 在浏览器中完成飞书授权
   ```

4. 开始使用：
   ```bash
   npm run upload -- ~/docs/my-file.md
   npm run download -- https://feishu.cn/docx/xxxxx
   ```

### 飞书应用配置检查清单

如果是全新环境，确认飞书开放平台上的应用已完成：

- [ ] 应用已创建，获取 App ID + App Secret
- [ ] 网页应用能力已启用
- [ ] 重定向 URL 已添加：`http://localhost:7777/callback`
- [ ] 权限已开通：`docx:document`、`docs:doc`、`drive:drive`、`wiki:wiki`、`offline_access`
- [ ] 应用版本已发布

---

## Claude Code Skill 生成

如果你使用 Claude Code，可以基于本项目自动创建 feishu-doc skill。

将以下内容保存到 `~/.claude/skills/feishu-doc/SKILL.md`：

````markdown
---
name: feishu-doc
description: 飞书文档 CLI 工具。上传本地 Markdown 到飞书文档、读取/下载/美化飞书文档、管理文档权限。当用户提到"飞书"、"feishu"、"lark"、读取/上传/下载/美化飞书文档、修改飞书权限时自动触发。
---

# 飞书文档 CLI (feishu-cli)

基于 OAuth 2.0 user_access_token，以用户身份操作飞书文档。

## 前提条件

- 需要先运行 `npm run auth`（在 `~/projects/feishu-cli` 目录下）获取 OAuth token
- auth 进程需保持运行以自动刷新 token（access_token 2 小时过期）
- 如果 token 过期，重新运行 `npm run auth` 并在浏览器中授权

## 命令参考

### 上传 Markdown 到飞书

```bash
cd ~/projects/feishu-cli && node scripts/upload.js <文件路径>
```

以用户身份创建文档，支持标题、段落、列表、代码块、引用、待办、分割线、表格、高亮块、内联格式。输出文档 URL。

### 读取飞书文档内容（推荐）

```bash
cd ~/projects/feishu-cli && node scripts/read.js <飞书文档URL或ID>
```

直接将文档内容以 Markdown 格式输出到终端，不写本地文件。适用于总结、问答等只需读取内容的场景。

### 下载飞书文档到本地

```bash
cd ~/projects/feishu-cli && node scripts/download.js <飞书文档URL或ID>
```

将飞书文档转为 Markdown 保存到当前目录。仅在需要本地文件时使用（如编辑后重新上传）。

### 美化飞书文档（beautify）

三步工作流：读取 → AI 美化 → 回写。

**步骤 1：读取文档为 Markdown**

```bash
cd ~/projects/feishu-cli && node scripts/beautify.js <飞书文档URL或ID> > original.md
```

**步骤 2：AI 美化**（在 Claude Code 中完成）

读取 original.md 内容，根据以下原则重新组织：
- 添加合适的标题层级（## / ###）
- 将零散内容组织为列表（- 或 1.）
- 适合的数据转为表格
- 重要信息用高亮块标注（`> [!NOTE]` / `> [!TIP]` / `> [!WARNING]` / `> [!IMPORTANT]`）
- 清理多余空行和格式混乱

保存美化后的内容到 beautified.md。

**步骤 3：回写到飞书**

```bash
# 创建新文档（安全，保留原文档）
cd ~/projects/feishu-cli && node scripts/beautify.js <原文档URL> --from beautified.md

# 或覆盖原文档
cd ~/projects/feishu-cli && node scripts/beautify.js <原文档URL> --from beautified.md --replace
```

### 高亮块（Callout）语法

上传和美化时支持 GitHub/Obsidian 风格的高亮块：

```markdown
> [!NOTE]
> 蓝色背景的提示信息

> [!TIP]
> 绿色背景的技巧

> [!WARNING]
> 橙色背景的警告

> [!IMPORTANT]
> 红色背景的重要信息
```

### 搜索飞书文档

```bash
cd ~/projects/feishu-cli && node scripts/search.js <关键词> [--type docx|doc|sheet|bitable|folder]
```

按关键词搜索用户有权限访问的飞书文档，返回标题、类型和 URL。

### 权限管理

```bash
# 查看文档权限
cd ~/projects/feishu-cli && node scripts/doc-permission.js get <飞书文档URL或ID>

# 批量设为公开可读（预设: public | tenant | private | editable）
cd ~/projects/feishu-cli && node scripts/doc-permission.js set <URL1> <URL2> ... --preset public

# 自定义权限
cd ~/projects/feishu-cli && node scripts/doc-permission.js set <URL> --link-share tenant_readable --external closed

# 添加协作者
cd ~/projects/feishu-cli && node scripts/doc-permission.js add <URL> --member user@example.com --member-type email --perm edit

# 列出协作者
cd ~/projects/feishu-cli && node scripts/doc-permission.js list <URL>
```

查看/设置文档分享权限、管理协作者。支持批量操作和 4 种预设方案（public/tenant/private/editable）。

### 多维表格操作

```bash
cd ~/projects/feishu-cli && node scripts/bitable-fields.js <app_token> <table_id>
cd ~/projects/feishu-cli && node scripts/bitable-read.js <app_token> <table_id> > output.csv
cd ~/projects/feishu-cli && node scripts/bitable-write.js <app_token> <table_id> data.csv
cd ~/projects/feishu-cli && node scripts/bitable-update.js <app_token> <table_id> update.csv
```

查看字段结构、导出记录为 CSV、从 CSV 导入记录、从 CSV 批量更新已有记录。app_token 和 table_id 从多维表格 URL 获取。

### 批量创建文档并回写链接

```bash
cd ~/projects/feishu-cli && node scripts/batch-create-docs.js <app_token> <table_id> \
  --name-field "姓名" --link-field "文档链接" --doc-title "报告-{姓名}"
```

从多维表格读取记录，为每条记录创建飞书文档，将文档 URL 回写到指定字段。支持标题模板（`{字段名}` 替换）和 Markdown 模板（`--template`）。

### 追加链接到已有文档

```bash
cd ~/projects/feishu-cli && node scripts/append-link.js <文档URL或ID> <链接URL> [显示文本]
```

### 离线格式转换

```bash
cd ~/projects/feishu-cli && npm run convert to-md <json文件>
cd ~/projects/feishu-cli && npm run convert to-feishu <md文件>
```

### 列出 Wiki 文档

```bash
cd ~/projects/feishu-cli && npm run list
```

### 查看文档元数据

```bash
cd ~/projects/feishu-cli && npm run fetch -- <飞书文档URL或ID>
```

## 自然语言用法

用户可以这样说：

- "把这个 Markdown 上传到飞书"
- "上传 report.md 到飞书"
- "下载这个飞书文档 https://feishu.cn/docx/xxx"
- "读一下这个飞书文档的内容"（使用 read.js）
- "总结一下这个飞书文档"（使用 read.js）
- "在飞书上搜索关于 XX 的文档"
- "帮我找飞书里包含 YY 的文档"
- "帮我美化这个飞书文档 https://feishu.cn/docx/xxx"（使用 beautify.js）
- "把这个飞书文档重新排版"（使用 beautify.js）
- "优化这个飞书文档的结构"（使用 beautify.js）
- "把这些飞书文档设为公开可读"（使用 doc-permission.js --preset public）
- "查看这个飞书文档的权限"（使用 doc-permission.js get）
- "把这个文档的链接分享关掉"（使用 doc-permission.js --preset private）
- "添加 xxx 为这个文档的编辑者"（使用 doc-permission.js add）
- "导出这个多维表格到 CSV"（使用 bitable-read）
- "把这个 CSV 导入到飞书多维表格"（使用 bitable-write）
- "更新多维表格里的这些记录"（使用 bitable-update）
- "看一下这个多维表格有哪些字段"（使用 bitable-fields）
- "给多维表格里的每条记录创建一个飞书文档"（使用 batch-create-docs）
- "在这个飞书文档末尾加一个链接"（使用 append-link）

## 注意事项

- 上传时第一个 `# 标题` 会被用作文档标题
- 图片暂不支持
- 含特殊 Unicode 字符的代码块可能上传失败，会被自动跳过
- 高亮块（callout）颜色值可能因飞书版本不同略有差异
- 如果提示 token 过期或认证失败，提示用户运行 `cd ~/projects/feishu-cli && npm run auth`
- 详细部署和配置说明见 `~/projects/feishu-cli/README.md`
````

### 快速生成 skill

在新电脑上使用 Claude Code 时，运行：

```
请读取 ~/projects/feishu-cli/README.md，按照其中的 "Claude Code Skill 生成" 章节，创建 feishu-doc skill。
```

Claude Code 会自动创建 skill 文件。

---

## 运行测试

```bash
npm test
```

使用 Node.js 内置测试框架（55 个测试用例），覆盖 Markdown ↔ Block JSON 双向转换、内联格式解析、表格边界情况、高亮块（Callout）解析、文档 ID 解析等。

---

## 相关文档

- [自动化部署指南](DEPLOYMENT.md) — AI 可执行的一键部署流程
- [项目范围说明](docs/PROJECT-SCOPE.md) — 项目文件组成、全局配置、部署清单
- [技术架构文档](docs/technical.md) — API 集成、格式转换引擎、错误处理策略
- [与 FeishuFS 对比](docs/comparison-with-feishufs.md) — 两个项目的定位与方案差异

---

## 致谢

核心 API 封装和 Markdown 转换器基于 [FeishuFS](https://github.com/wangjialiang678/FeishuFS) 项目精简而来。feishu-cli 去掉了同步引擎，专注于单次操作的 CLI 体验。
