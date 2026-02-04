# Changelog

## [1.0.1] - 2026-02-04

### 文档

**部署和项目说明**
- 新增 `DEPLOYMENT.md` — AI 可执行的自动化部署指南，支持一键克隆项目、安装依赖、配置凭证、部署全局 Skill、OAuth 授权全流程
- 新增 `docs/PROJECT-SCOPE.md` — 项目范围完整说明，明确区分项目文件、全局配置、排除文件（掌天瓶系统）的边界

### 新功能

**文档权限管理** (`doc-permission`)
- `npm run doc-permission -- get <URL>` — 查看文档当前分享权限设置
- `npm run doc-permission -- set <URL...> --preset public|tenant|private|editable` — 批量设置权限（4 种预设方案）
- `npm run doc-permission -- set <URL> --link-share <值> --external <值>` — 自定义权限字段
- `npm run doc-permission -- add <URL> --member <ID> --perm view|edit|full_access` — 添加协作者
- `npm run doc-permission -- list <URL>` — 列出文档协作者
- 支持并行处理多个文档，支持 8 种权限字段自定义

**上传验证**
- `node scripts/verify.js <doc-id> <local-file.md>` — 比对飞书文档与本地源文件的内容一致性
- 自动忽略已知格式差异（链接形式、列表编号、空行）
- 输出 PASS/FAIL 及差异详情

**Claude Code Skill 同步**
- 新增 `.claude/skills/feishu-doc/SKILL.md` — 飞书文档操作的 Claude Code skill 定义
- 包含批量上传工作流编排规则：授权检查 → 临时文件 → 并行上传 → 链接互联 → 验证

### 修复

**上传批次丢失问题** (`upload.js`)
- 修复 flush 二分查找时后续批次被丢失的问题：当某批次失败触发二分查找时，原 `pending` 数组被覆盖，导致后续待上传批次无法访问
- 修复方案：在遍历前将 `pending` 快照到局部变量 `toFlush`，防止二分查找覆盖原数组
- 影响范围：当单个批次（50个块）上传失败且需要二分定位坏块时，原逻辑会丢失该批次之后的所有待上传内容

### 代码质量

**代码清理**
- 清理 `api/feishu.js` 中约 460 行同步引擎遗留代码（文件从 ~933 行减少至 437 行）
  - 删除函数：`deleteRemoteDocument`, `collectWikiDocNodes`, `createDocumentFromMarkdown`, `subscribeToDocEvents`, `createChangeProcessor`, `syncNewDocsFromWiki`
- 清理 `api/helpers.js` 中约 250 行遗留工具函数（文件从 ~291 行减少至 41 行）
  - 保留：`readToken`, `sanitizeFilename`, `expandHomeDir`, `extractDocumentId`
  - 删除：`hashFile`, `readManifest`, `writeManifest`, `ensurePosixPath`, `resolveSyncFolder`, `pickAppCredentials`, `normalizeLoggerLevel`, `normalizeFileTypes`, `ensureUniqueFilePath`, `fileExists`, `deleteLocalFile`, `ensureUniqueFilePathWithFs`, `shouldSyncLocalPath`, `startLocalWatcher`, `buildConflictPath`, `resolveFileType`
- 代码规模：核心代码从 ~4,100 行减少至 ~3,352 行（-18%）
- 补充 `package.json` 缺失的 npm scripts：`read`, `verify`
- 补充 `README.md` 目录树中缺失的 `scripts/verify.js`

## 2026-02-03

### 新功能

**文档美化** (`beautify`)
- `npm run beautify -- <文档URL>` — 读取飞书文档，输出 Markdown 到 stdout（供 AI 美化）
- `npm run beautify -- <文档URL> --from <beautified.md>` — 将美化后的 Markdown 上传为新文档
- `npm run beautify -- <文档URL> --from <beautified.md> --replace` — 覆盖原文档
- 支持读取 → 美化 → 回写的完整工作流

**Callout 高亮块**
- 上传支持 `> [!NOTE]` / `> [!TIP]` / `> [!WARNING]` / `> [!IMPORTANT]` 语法
- 下载时飞书 callout block 自动转为对应的 GitHub 风格 callout 语法
- Emoji 自动映射：💡→TIP、✏️→NOTE、⚠️→WARNING、❗→IMPORTANT
- 通过 Batch Descendants API（`/blocks/{id}/descendant`）上传，支持多行内容

**多维表格（Bitable）操作**
- `npm run bitable-fields <app_token> <table_id>` — 查看表格字段结构，支持 `--json` 输出
- `npm run bitable-read <app_token> <table_id>` — 导出全部记录为 CSV（stdout），支持 `--json`
- `npm run bitable-write <app_token> <table_id> <csv_file>` — 从 CSV 批量导入记录（500条/批）
- 内置 RFC 4180 CSV 解析器，无外部依赖
- 复杂字段类型自动格式化（数组→分号分隔，对象→取 text/name）

**交互式 CLI 增强**
- 新增 `scripts/cli-utils.js` — 共享 spinner 和 progress bar 工具
- `upload.js` — 解析/创建阶段显示 spinner，上传阶段显示 progress bar
- `download.js` — 获取/下载阶段显示 spinner
- `search.js` — 搜索阶段显示 spinner
- `list.js` — 加载 Wiki 树阶段显示 spinner（重构为先收集再输出）
- `bitable-write.js` — 批量写入阶段显示 progress bar
- 所有 spinner/progress 输出走 stderr，不污染 stdout 管道
- 非 TTY 环境自动降级为文本输出（百分比里程碑）

### 依赖

- 新增 `ora` ^9.1.0 — ESM spinner
- 新增 `cli-progress` ^3.12.0 — 进度条

### 修复

- **引用块上传失败**: 修复上传 Markdown 时 blockquote（`>` 引用块）失败的问题 — `quote`（type 15）不是飞书 docx API 合法的顶层块类型，改用 `quote_container`（type 34）+ descendant API 结构，通过 `/blocks/{id}/descendant` API 插入子块。
- **表格内容丢失**: 表格 cell 内的 Markdown 行内格式（链接、粗体、斜体、代码等）现在会被正确解析并上传。之前 `[链接文本](url)` 在表格中会显示为纯文本，现在显示为可点击的链接。
- **多余空行**: Markdown 空行不再生成空 paragraph block。之前上传后飞书文档中会出现大量多余的空白段落，现在空行仅作为段落分隔符处理。
- **大表格上传失败**: 移除了错误的 `MAX_BATCH_DESCENDANT_ROWS = 9` 行数限制。之前 >9 行的表格会回退到 Children API + 逐 cell 填充，而 Children API 对大表格返回 `invalid param`。现在所有表格统一使用 Batch Descendants API（经测试支持 50+ 行）。

### 优化

- **表格上传性能**: 改用 Batch Descendants API（`/docx/v1/documents/{id}/blocks/{id}/descendant`）一次性创建完整表格，替换了之前的逐 cell 填充方案。
  - **之前**: 创建空表格 → 等待 800ms → 重试获取 cell（最多 5 次）→ 逐 cell 写入（每 cell 50ms 间隔），一个 10×5 表格约 53 秒
  - **现在**: 单次 API 调用创建完整表格（含所有 cell 内容），一个 10×5 表格约 1-2 秒
  - 消除了表格创建的时序问题（cell 未就绪导致内容丢失）
- **列宽计算优化**:
  - 新增 CJK 字符检测，中文/日文/韩文字符算 2 倍显示宽度
  - Markdown 链接语法 `[text](url)` 只按可见文本 `text` 计算宽度，不再将 URL 计入
  - 调整参数：CHAR_WIDTH 14→10px, MIN 80→60px, MAX 400→360px，表格不再过宽

### 代码质量（代码审查修复）

**P0 — 表格核心**
- 将 `feishu.js` 表格创建改为 Batch Descendants API，与 `upload.js` 统一
- 表格工具函数（`tempId`、`buildTableDescendants`、`calculateColumnWidths` 等）提取为 `feishu.js` 共享导出
- 删除 `upload.js` 中的重复函数定义
- 新增 >9 行大表格自动回退逐 cell 填充策略
- `upload.js` 使用 `BLOCK_TYPE` 常量替换硬编码数字

**P1 — 稳定性和一致性**
- 修正 Batch Descendants 顺序：父节点（cell）在子节点（text）前
- `CREATE_BATCH_SIZE` 从 100 改为 50，与文档和 `upload.js` 对齐
- `response.text()` 包裹在 try-catch 中，网络中断时抛出明确错误
- `retryAfter` 添加 60 秒上限（`MAX_RETRY_DELAY_MS`），防止异常长等待
- `extractDocumentId()` 提取到 `helpers.js`，`download.js`/`fetch.js`/`read.js` 共享复用

**P2 — 小改进**
- `helpers.js` 中 `process.env.HOME` 改为 `os.homedir()`
- `createDocument` 重复 ID 校验收敛为局部函数 `extractId`
- 新增 `fetchAllPaged()` 通用分页函数，`fetchAllBlocks`/`fetchWikiNodes` 复用
- `search.js` 类型参数 split 后增加 `.filter(Boolean)` 过滤空值
- 新增 15 个测试用例：表格边界、复合行内格式、extractDocumentId（总计 44 个）

### 技术细节

- 删除了 `fetchAllCells()` 函数（不再需要）
- 删除了 `buildCellTextBlocks()` 函数（`inlineMarkdownToElements` 已替代）
- 新增 `buildTableDescendants()` 函数构建完整表格嵌套结构
- 新增 `getDisplayWidth()` 函数计算 CJK 感知的显示宽度
- 新增 `stripMarkdownForWidth()` 函数去除链接语法后计算宽度
- 新增 `fetchAllPaged()` 通用分页迭代函数

### 文档

- 更新 `docs/technical.md`：重写表格上传部分，加入大表格策略、共享函数列表、测试覆盖更新
- 新增 `docs/research/upload-optimization-2026-02-03.md`：上传优化调研（20+ GitHub 项目分析）
- 新增 `docs/research/table-row-append-2026-02-03.md`：表格行追加 API 调研
- 新增 `docs/research/batch-update-cells-2026-02-03.md`：batch_update API 调研
- 新增 `CHANGELOG.md`：本文件

---

## [1.0.0] - 2026-02-02

### 初始版本

- Markdown 上传/下载飞书文档
- OAuth 2.0 用户身份认证（自动刷新）
- 文档搜索
- 支持标题/段落/列表/代码块/引用/待办/表格/分割线/行内格式
- 限流重试（指数退避）
- 坏 Block 二分法定位与跳过
