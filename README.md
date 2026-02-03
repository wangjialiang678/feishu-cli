# feishu-cli

飞书文档 CLI 工具 — 以用户身份（OAuth 2.0）上传/下载 Markdown 与飞书文档。

## 功能

- **上传** — 本地 Markdown 文件 → 飞书文档（支持标题、段落、列表、代码块、引用、待办、表格、分割线、内联格式）
- **下载** — 飞书文档 → 本地 Markdown 文件
- **读取** — 飞书文档内容直接输出为 Markdown（不写本地文件）
- **搜索** — 按关键词搜索飞书文档，支持类型过滤
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
| `offline_access` | 获取 refresh_token |

#### 2.6 发布应用版本

**重要**：权限修改后需要创建版本并发布才能生效。
左侧菜单 → **版本管理与发布** → 创建版本 → 申请发布 → 审核通过后生效。

### 3. 创建配置文件

```bash
cp config.example.json config.json
```

编辑 `config.json`：

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
| `**粗体**` `*斜体*` `` `代码` `` `[链接](url)` `~~删除线~~` | 内联格式 |

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
│   └── convert.js         # 离线 Markdown ↔ Block JSON 转换
├── test/
│   └── feishu-md.test.js  # Markdown ↔ Block JSON 转换单元测试
└── docs/
    ├── technical.md       # 技术架构文档
    ├── comparison-with-feishufs.md  # 与 FeishuFS 项目对比
    └── research/          # 技术调研报告
```

---

## 在新电脑上部署

### 步骤

1. 克隆仓库：
   ```bash
   git clone <repo-url> ~/projects/feishu-cli
   cd ~/projects/feishu-cli
   npm install
   ```

2. 创建配置：
   ```bash
   cp config.example.json config.json
   # 编辑 config.json，填入 clientId 和 clientSecret
   ```

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
description: 飞书文档 CLI 工具。上传本地 Markdown 到飞书文档、读取/下载飞书文档。当用户提到"飞书"、"feishu"、"lark"、读取/上传/下载飞书文档时自动触发。
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

以用户身份创建文档，支持标题、段落、列表、代码块、引用、待办、分割线、表格、内联格式。输出文档 URL。

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

### 搜索飞书文档

```bash
cd ~/projects/feishu-cli && node scripts/search.js <关键词> [--type docx|doc|sheet|bitable|folder]
```

按关键词搜索用户有权限访问的飞书文档，返回标题、类型和 URL。

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

## 注意事项

- 上传时第一个 `# 标题` 会被用作文档标题
- 图片暂不支持
- 含特殊 Unicode 字符的代码块可能上传失败，会被自动跳过
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

使用 Node.js 内置测试框架（44 个测试用例），覆盖 Markdown ↔ Block JSON 双向转换、内联格式解析、表格边界情况、文档 ID 解析等。

---

## 相关文档

- [技术架构文档](docs/technical.md) — API 集成、格式转换引擎、错误处理策略
- [与 FeishuFS 对比](docs/comparison-with-feishufs.md) — 两个项目的定位与方案差异

---

## 致谢

核心 API 封装和 Markdown 转换器基于 [FeishuFS](https://github.com/wangjialiang678/FeishuFS) 项目精简而来。feishu-cli 去掉了同步引擎，专注于单次操作的 CLI 体验。
