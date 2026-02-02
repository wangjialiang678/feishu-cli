# feishu-cli 技术架构文档

## 概述

feishu-cli 是一个纯 CLI 工具，以用户身份（OAuth 2.0 user_access_token）操作飞书文档。核心能力包括 Markdown 上传/下载、文档搜索、格式转换，不含同步引擎。

**技术栈**：Node.js 18+（ESM）、全局 fetch API、`@larksuiteoapi/node-sdk`（仅用于 OAuth token 交换）

**代码规模**：约 2,100 行核心代码 + 350 行测试

---

## 模块架构

```
┌─────────────────────────────────────────────┐
│                 CLI Scripts                  │
│  auth │ upload │ download │ read │ search   │
│  fetch │ list │ convert                      │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│                 API Layer                    │
│  feishu.js    │ feishu-md.js │ helpers.js   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│            飞书 Open API (REST)              │
│        https://open.feishu.cn/open-apis     │
└─────────────────────────────────────────────┘
```

### api/feishu.js（~860 行）

核心 API 封装层，负责所有飞书 REST API 调用。

**主要导出函数**：

| 函数 | 用途 |
|------|------|
| `apiRequest(method, path, token, options)` | 底层 HTTP 请求，含限流重试 |
| `apiGet/apiPost/apiDelete` | HTTP 方法快捷封装 |
| `createDocument(token, title)` | 创建空白文档 |
| `fetchAllBlocks(documentId, token)` | 分页获取文档全部 Block |
| `fetchDocumentMeta(documentId, token)` | 获取文档元数据 |
| `appendBlocksWithTables(documentId, token, blocks)` | 上传 Block（含表格异步填充） |
| `uploadMarkdownToDocument(documentId, token, markdown)` | 清空文档 + 上传新内容 |
| `createDocumentFromMarkdown(spaceId, token, markdown)` | 创建文档并加入 Wiki |
| `downloadDocumentToFile(documentId, token, metadata, filePath)` | 下载文档为 Markdown 文件 |
| `fetchWikiNodes(spaceId, token)` | 递归列出 Wiki 文档树 |

**限流重试策略**：

```
HTTP 429 → 检查 Retry-After 头
  → 有：等待指定秒数
  → 无：指数退避 min(8000ms, 1000ms × 2^attempt)
  → 最多重试 5 次
```

**批量上传策略**：

- 每批 50 个 Block
- 批量失败时使用二分法定位坏 Block，跳过后继续
- 表格需先创建结构，再逐单元格异步填充

### api/feishu-md.js（~1,100 行）

Markdown 与飞书 Block JSON 的双向转换引擎。

**主要导出函数**：

| 函数 | 用途 |
|------|------|
| `feishuToMarkdown(doc)` | Block JSON → Markdown |
| `markdownToBlocks(markdown)` | Markdown → 扁平 Block 数组 |
| `markdownToFeishu(markdown)` | Markdown → 嵌套 Block 树 + 元数据 |
| `inlineMarkdownToElements(text)` | 解析行内格式（粗体/斜体/代码/链接） |

**支持的 Block 类型**：

| 类型 | Block ID | 说明 |
|------|---------|------|
| page | 1 | 文档根节点 |
| text | 2 | 普通段落 |
| heading1-9 | 3-11 | 标题级别 |
| bullet | 12 | 无序列表 |
| ordered | 13 | 有序列表 |
| code | 14 | 代码块 |
| quote | 15 | 引用 |
| todo | 17 | 待办事项 |
| divider | 22 | 分割线 |
| image | 27 | 图片（仅下载方向支持） |
| table | 31 | 表格 |
| table_cell | 32 | 表格单元格 |
| quote_container | 34 | 引用容器 |

**行内格式解析**：

通过正则表达式解析 Markdown 行内语法，生成飞书 TextElement 数组：

- `**bold**` → `{ bold: true }`
- `*italic*` / `_italic_` → `{ italic: true }`
- `` `code` `` → `{ inline_code: true }`
- `[text](url)` → `{ link: { url } }`
- `~~strike~~` → `{ strikethrough: true }`

**表格处理**：

- 上传：解析 Markdown 管道语法 `|---|---|`，生成 table Block + cell Block
- 下载：将飞书表格转为 HTML `<table>` 格式（保留 colspan/rowspan）

### api/helpers.js（~280 行）

工具函数集，提供 Token I/O、文件操作、路径处理。

**关键函数**：

| 函数 | 用途 |
|------|------|
| `readToken(tokenPath)` | 从文件读取 OAuth token |
| `hashFile(filePath)` | SHA256 文件内容哈希 |
| `sanitizeFilename(name)` | 文档标题 → 安全文件名 |
| `pickAppCredentials(config)` | 从 config 或环境变量获取应用凭证 |

### config.js（~60 行）

配置加载与验证，支持 `~` 路径展开、必填字段校验。

---

## 认证流程

```
用户                    auth.js (:7777)              飞书 API
 │                          │                           │
 │  npm run auth            │                           │
 ├─────────────────────────>│                           │
 │                          │  启动 HTTP 服务器          │
 │                          │  构造 OAuth URL            │
 │  浏览器打开授权页面      │                           │
 │<─────────────────────────│                           │
 │                          │                           │
 │  用户授权                │                           │
 │─────────────────────────>│                           │
 │                          │  POST /authen/v2/oauth/token
 │                          │  (code → tokens)          │
 │                          ├──────────────────────────>│
 │                          │  access_token             │
 │                          │  refresh_token            │
 │                          │  expires_in               │
 │                          │<──────────────────────────│
 │                          │                           │
 │                          │  写入 tokenPath           │
 │                          │  设置刷新定时器            │
 │  ✓ 认证成功              │  (过期前 20% 时刷新)       │
 │<─────────────────────────│                           │
```

**OAuth 权限范围**：

| 权限 | 用途 |
|------|------|
| `docx:document` | 读写新版文档 |
| `docs:doc` | 读写旧版文档 |
| `drive:drive` | 读写云空间文件 |
| `wiki:wiki` | 读写知识库 |
| `offline_access` | 获取 refresh_token |

**Token 刷新**：

- access_token 有效期 2 小时
- auth 进程在过期前 20%（约 96 分钟）自动刷新
- 使用 refresh_token 换取新 access_token
- token 以明文存储于 `user-token.txt`

---

## 飞书 API 集成

### 使用的端点

| 方法 | 端点 | 用途 |
|------|------|------|
| GET | `/authen/v1/authorize` | OAuth 授权页面 |
| POST | `/authen/v2/oauth/token` | 换取/刷新 token |
| GET | `/docx/v1/documents/{id}` | 获取文档元数据 |
| GET | `/docx/v1/documents/{id}/blocks` | 获取文档 Block（分页） |
| POST | `/docx/v1/documents/{id}/blocks/{blockId}/children` | 追加 Block |
| DELETE | `/docx/v1/documents/{id}/blocks/{blockId}/children/batch_delete` | 批量删除 Block |
| POST | `/docx/v1/documents` | 创建新文档 |
| DELETE | `/drive/v1/files/{token}` | 删除文档 |
| GET | `/wiki/v2/spaces/{spaceId}/nodes` | 列出 Wiki 节点（分页） |
| POST | `/wiki/v2/spaces/{spaceId}/nodes/move_docs_to_wiki` | 文档移入 Wiki |
| POST | `/suite/docs-api/search/object` | 搜索文档 |

### API 调用约定

- 基础 URL：`https://open.feishu.cn/open-apis`
- 认证头：`Authorization: Bearer {access_token}`
- 请求体：`Content-Type: application/json; charset=utf-8`
- 成功标识：响应 `code === 0`
- 分页：`page_token` + `has_more` 迭代

### 批量操作限制

| 操作 | 单次上限 |
|------|---------|
| Block 创建 | 100 个/请求（实际使用 50 个/批） |
| Block 删除 | 100 个/请求 |

---

## 错误处理

### API 限流

- HTTP 429 自动重试，指数退避，最多 5 次
- 支持 `Retry-After` 响应头

### 坏 Block 定位

上传时如果一批 Block 失败，使用二分法缩小范围：
1. 将批次一分为二
2. 分别尝试上传
3. 递归定位失败的单个 Block
4. 跳过坏 Block，继续上传剩余内容

常见坏 Block：含 box-drawing 字符（`┌─┐`）等特殊 Unicode 的代码块。

### 文档 ID 解析

所有接受文档参数的脚本支持两种输入：
- 完整 URL：`https://feishu.cn/docx/xxxxx`
- 纯 ID：`xxxxx`

解析逻辑：去除 query/hash → 去除尾部 `/` → 取最后一个路径段。

---

## 测试

使用 Node.js 内置 `node:test` 框架，覆盖约 350 行测试用例。

**测试范围**：

| 测试套件 | 覆盖内容 |
|---------|---------|
| feishuToMarkdown | Block JSON → Markdown 转换（标题/列表/代码/分割线/待办/行内格式/链接） |
| markdownToBlocks | Markdown → Block 解析（标题提取/列表/代码/表格/待办） |
| inlineMarkdownToElements | 行内格式解析（粗体/斜体/代码/链接/删除线） |
| Roundtrip | Markdown → Block → Feishu → Markdown 往返一致性 |
| 边界情况 | null/undefined 输入、空文档、特殊字符 |

**运行**：

```bash
npm test
# 等价于 node --test test/*.test.js
```

---

## 已知限制

- **图片不支持**：上传方向不支持图片（需额外文件上传权限），下载方向可获取图片 URL
- **嵌套列表展平**：多级列表会被展平为同级
- **特殊 Unicode**：含 box-drawing 等字符的代码块可能上传失败（会被自动跳过）
- **单向创建**：上传总是创建新文档，不支持更新已有文档（更新能力在 FeishuFS 中实现）
- **无自动同步**：纯按需操作，不监听变更
