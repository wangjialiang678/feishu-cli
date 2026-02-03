# Changelog

## [Unreleased] - 2026-02-03

### 修复

- **表格内容丢失**: 表格 cell 内的 Markdown 行内格式（链接、粗体、斜体、代码等）现在会被正确解析并上传。之前 `[链接文本](url)` 在表格中会显示为纯文本，现在显示为可点击的链接。
- **多余空行**: Markdown 空行不再生成空 paragraph block。之前上传后飞书文档中会出现大量多余的空白段落，现在空行仅作为段落分隔符处理。

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
