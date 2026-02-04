# feishu-cli 技术架构文档

## 概述

feishu-cli 是一个纯 CLI 工具，以用户身份（OAuth 2.0 user_access_token）操作飞书文档。核心能力包括 Markdown 上传/下载、文档搜索、格式转换，不含同步引擎。

**技术栈**：Node.js 18+（ESM）、全局 fetch API、`@larksuiteoapi/node-sdk`（仅用于 OAuth token 交换）

**代码规模**：约 3,352 行核心代码 + 680 行测试

---

## 模块架构

```
┌─────────────────────────────────────────────┐
│                 CLI Scripts                  │
│  auth │ upload │ download │ read │ search   │
│  fetch │ list │ convert │ beautify           │
│  bitable-* │ doc-permission │ verify         │
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

### api/feishu.js（~437 行）

核心 API 封装层，负责所有飞书 REST API 调用。

**主要导出函数**：

| 函数 | 用途 |
|------|------|
| `apiRequest(method, path, token, options)` | 底层 HTTP 请求，含限流重试（retry-after 上限 60s） |
| `apiGet/apiPost/apiDelete` | HTTP 方法快捷封装 |
| `createDocument(token, title)` | 创建空白文档 |
| `fetchAllBlocks(documentId, token)` | 分页获取文档全部 Block（基于通用 `fetchAllPaged`） |
| `fetchDocumentMeta(documentId, token)` | 获取文档元数据 |
| `appendBlocksWithTables(documentId, token, blocks)` | 上传 Block（含表格 Batch Descendants） |
| `uploadMarkdownToDocument(documentId, token, markdown)` | 清空文档 + 上传新内容 |
| `downloadDocumentToFile(documentId, token, metadata, filePath)` | 下载文档为 Markdown 文件 |
| `fetchWikiNodes(spaceId, token)` | 递归列出 Wiki 文档树（基于通用 `fetchAllPaged`） |
| `tempId(prefix)` | 生成表格临时 block ID |
| `buildTableDescendants(rows, colSize, columnWidth)` | 构建表格 Batch Descendants 数组 |
| `calculateColumnWidths(rows, colSize)` | 根据内容计算列宽（CJK 感知） |
| `buildCalloutDescendants(block)` | 构建 callout Batch Descendants 数组 |
| `buildQuoteContainerDescendants(block)` | 构建 quote_container Batch Descendants 数组 |
| `stripMarkdownForWidth(text)` / `getDisplayWidth(text)` | 列宽计算辅助函数 |

**限流重试策略**：

```
HTTP 429 → 检查 Retry-After 头
  → 有：等待指定秒数（上限 60 秒）
  → 无：指数退避 min(8000ms, 1000ms × 2^attempt)
  → 所有延迟不超过 MAX_RETRY_DELAY_MS (60s)
  → 最多重试 5 次
```

**批量上传策略**：

- 普通 Block（段落/标题/列表等）：每批 50 个，通过 `/blocks/{id}/children` 追加
- 批量失败时使用二分法定位坏 Block，跳过后继续
- 表格：通过 Batch Descendants API 一次创建完整结构（见下方表格处理详情）
- Callout：通过 Batch Descendants API 创建 callout + 子节点
- Quote Container：通过 Batch Descendants API 创建 quote_container + 子节点

### api/feishu-md.js（~1,240 行）

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
| quote | 15 | 引用（旧版，不作为顶层块使用） |
| todo | 17 | 待办事项 |
| callout | 19 | 高亮块（[!NOTE]/[!TIP]/[!WARNING]/[!IMPORTANT]） |
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

- 上传：解析 Markdown 管道语法 `|---|---|`，通过 Batch Descendants API 一次性创建完整表格
- 下载：将飞书表格转为 HTML `<table>` 格式（保留 colspan/rowspan）

**表格上传详情**：

使用 Batch Descendants API（`/docx/v1/documents/{id}/blocks/{id}/descendant`），在单次 API 调用中创建完整的表格结构（table → table_cell → text），包括所有 cell 内容。

1. **Batch Descendants 方案**（≤9 行，快速路径）
   - 构建完整的 descendants 数组：table block（type 31）→ cell block（type 32）→ text block（type 2）
   - 生成临时 block_id，API 返回临时 ID → 真实 ID 的映射
   - descendants 数组中父节点必须在子节点前面（cell 在 text 前）
   - 一次 API 调用完成所有工作，无需等待、无需重试
   - Batch Descendants 单次限制 9 行

2. **大表格回退方案**（>9 行）
   - 创建含正确行列数的空表格（无 9 行限制）
   - API 返回所有 cell ID
   - 逐 cell 填充内容，cell 文本通过 `inlineMarkdownToElements()` 解析
   - 调研确认 `batch_update` API 无法批量写入多个 cell，逐 cell 是当前最优方案

3. **列宽自适应**：根据每列最大**显示宽度**自动计算 `column_width`
   - CJK 字符（中文/日文/韩文）算 2 倍宽度，ASCII 字符算 1 倍
   - Markdown 链接语法 `[text](url)` 只计算可见文本 `text` 的宽度
   - 计算公式：`显示宽度 × 10px`，最小 60px，最大 360px

4. **Cell 内容行内格式**：cell 文本通过 `inlineMarkdownToElements()` 解析，支持链接/粗体/斜体/代码/删除线

**为什么选择 Batch Descendants 而非逐 cell 填充？**

调研了 GitHub 上 20+ 个飞书文档项目后，发现两种方案：

| 方案 | 性能（10×5 表） | API 调用次数 | 可靠性 |
|------|----------------|-------------|--------|
| A. 逐 cell 填充 | ~53 秒 | 1 + N（N=cell 数） | 需等待+重试 |
| B. Batch Descendants | ~1-2 秒 | 1 | 原子操作 |

方案 A 的问题：创建空表格后飞书 API 可能尚未准备好 cell，需要 800ms 等待 + 最多 5 次重试 + 每 cell 50ms 间隔防限流，仍可能因 cell 不足导致内容丢失。方案 B 将整个表格作为原子操作一次创建，彻底消除了时序问题。

详细调研记录：
- [上传优化调研](research/upload-optimization-2026-02-03.md) — 20+ GitHub 项目分析、Batch Descendants API 详情
- [表格行追加 API 调研](research/table-row-append-2026-02-03.md) — InsertTableRow API、9 行限制适用范围
- [batch_update API 调研](research/batch-update-cells-2026-02-03.md) — 确认无法批量写入 cell 内容

### api/helpers.js（~41 行）

轻量工具函数集，提供 Token I/O、路径处理、文档 ID 解析。

**导出函数**：

| 函数 | 用途 |
|------|------|
| `readToken(tokenPath)` | 从文件读取 OAuth token |
| `sanitizeFilename(name)` | 文档标题 → 安全文件名 |
| `expandHomeDir(path)` | `~` 路径展开（使用 `os.homedir()`） |
| `extractDocumentId(input)` | 从 URL 或纯 ID 提取文档 ID（共享函数，download/fetch/read 复用） |

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
| `bitable:bitable` | 读写多维表格 |
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
| POST | `/docx/v1/documents/{id}/blocks/{blockId}/descendant` | 创建嵌套 Block（表格） |
| DELETE | `/docx/v1/documents/{id}/blocks/{blockId}/children/batch_delete` | 批量删除 Block |
| POST | `/docx/v1/documents` | 创建新文档 |
| DELETE | `/drive/v1/files/{token}` | 删除文档 |
| GET | `/wiki/v2/spaces/{spaceId}/nodes` | 列出 Wiki 节点（分页） |
| POST | `/wiki/v2/spaces/{spaceId}/nodes/move_docs_to_wiki` | 文档移入 Wiki |
| POST | `/suite/docs-api/search/object` | 搜索文档 |
| GET | `/drive/v1/permissions/{token}/public` | 查看文档公开权限 |
| PATCH | `/drive/v1/permissions/{token}/public` | 设置文档公开权限 |
| GET | `/drive/v1/permissions/{token}/members` | 列出文档协作者 |
| POST | `/drive/v1/permissions/{token}/members` | 添加文档协作者 |

### API 调用约定

- 基础 URL：`https://open.feishu.cn/open-apis`
- 认证头：`Authorization: Bearer {access_token}`
- 请求体：`Content-Type: application/json; charset=utf-8`
- 成功标识：响应 `code === 0`
- 分页：`page_token` + `has_more` 迭代

### 批量操作限制

| 操作 | 单次上限 | 说明 |
|------|---------|------|
| Block 追加（children） | 50 个/批 | 普通段落/标题/列表等（`CREATE_BATCH_SIZE = 50`） |
| Block 嵌套创建（descendant） | 9 行/次 | 表格 Batch Descendants |
| Block 删除 | 100 个/请求 | `DELETE_BATCH_SIZE = 100` |
| 空表格创建 | 无行数限制 | >9 行表格使用此方式 + 逐 cell 填充 |
| Callout/Quote 嵌套创建 | 无限制 | 通过 Batch Descendants API 创建 |

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

### 空行处理

Markdown 中的空行是段落分隔符，不生成 Block。调研确认所有主流 Markdown → 飞书转换项目均采用此策略（跳过 blank_line token，不创建空 paragraph block）。

### 文档 ID 解析

所有接受文档参数的脚本支持两种输入：
- 完整 URL：`https://feishu.cn/docx/xxxxx`
- 纯 ID：`xxxxx`

解析逻辑：去除 query/hash → 去除尾部 `/` → 取最后一个路径段。

---

## 测试

使用 Node.js 内置 `node:test` 框架，62 个测试用例（约 680 行）。

**测试范围**：

| 测试套件 | 覆盖内容 |
|---------|---------|
| feishuToMarkdown | Block JSON → Markdown 转换（标题/列表/代码/分割线/待办/行内格式/链接） |
| markdownToBlocks | Markdown → Block 解析（标题提取/列表/代码/表格/待办） |
| markdownToBlocks: table edge cases | 表格边界情况（空 cell、单列、行内格式、特殊字符） |
| inlineMarkdownToElements | 行内格式解析（粗体/斜体/代码/链接/删除线） |
| inlineMarkdownToElements: complex cases | 复合行内格式（相邻格式、特殊 URL、空字符串） |
| extractDocumentId | 文档 ID 解析（完整 URL、query/hash、尾部斜杠、纯 ID、空值） |
| callout: feishuToMarkdown | Callout Block → [!TYPE] 语法转换 |
| callout: markdownToBlocks | [!NOTE]/[!WARNING] 等解析、与普通引用区分 |
| callout: markdownToFeishu roundtrip | Callout 往返一致性、树结构验证 |
| quote_container: markdownToBlocks | 引用块解析（单行/多行/空/行内格式/与 callout 区分） |
| buildQuoteContainerDescendants | Quote Descendants 结构构建 |
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
