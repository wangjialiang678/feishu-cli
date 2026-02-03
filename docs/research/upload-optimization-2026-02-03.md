# 调研报告：Markdown 上传飞书文档优化方案

**日期**: 2026-02-03
**调研范围**: GitHub 20+ 开源项目、飞书官方 API 文档、CSDN/知乎社区文章

---

## 一、核心结论

飞书 Open API **不提供** Markdown/DOCX/HTML 导入接口，所有文档创建必须通过 Block-by-Block 方式逐块构建。GitHub 上所有上传方向的项目（Go/Java/Node.js/Python）均采用此方案。

---

## 二、发现的三个关键问题及解决方案

### 问题 1：表格 cell 内链接丢失

**根因**: 表格 cell 内容作为纯文本写入 API，未解析 Markdown 行内格式。`[游戏化系统](url)` 被当作纯文本上传，而非带链接的文本。

**修复**: cell 内容通过 `inlineMarkdownToElements()` 解析后再写入，支持链接/粗体/斜体/代码等行内格式。

### 问题 2：多余空行

**根因**: `feishu-md.js` 中 Markdown 空行被转为空 paragraph block（`pushBlankLine()`）。

**调研发现**: 分析了 8+ 个项目（baoyudu/markdown2feishu、ztxtxwd/open-feishu-mcp-server 等），**没有任何项目**为空行创建空 block。Markdown 空行是段落分隔符，不是内容。

**修复**: 删除 `pushBlankLine()` 调用。

### 问题 3：表格上传慢

**根因**: 采用逐 cell 填充策略（创建空表格 → 等待 800ms → 逐 cell 写入内容，每 cell 间隔 50ms）。一个 10×5 表格需要 ~53 秒。

**调研发现**: 存在两种方案：

| 方案 | 代表项目 | 性能 |
|------|----------|------|
| A. 逐 cell 填充 | redleaves/feishu-mcp-server、本项目（旧） | ~53 秒/10×5 表 |
| B. Batch Descendants | cso1z/Feishu-MCP、ztxtxwd/open-feishu-mcp-server | ~1-2 秒/10×5 表 |

**修复**: 改用 Batch Descendants API（`/docx/v1/documents/{id}/blocks/{id}/descendant`），一次 API 调用创建完整表格（含所有 cell 内容）。

---

## 三、Batch Descendants API 详情

### 端点

```
POST /open-apis/docx/v1/documents/{document_id}/blocks/{block_id}/descendant?document_revision_id=-1
```

### 请求体结构

```json
{
  "children_id": ["临时表格ID"],
  "descendants": [
    { "block_id": "临时表格ID", "block_type": 31, "table": {...}, "children": ["cell_0_0", ...] },
    { "block_id": "cell_0_0", "block_type": 32, "table_cell": {}, "children": ["txt_0_0"] },
    { "block_id": "txt_0_0", "block_type": 2, "text": { "elements": [...] }, "children": [] }
  ]
}
```

### 关键注意事项

1. **临时 Block ID**: 任意唯一字符串，API 返回临时 ID → 真实 ID 的映射
2. **descendants 顺序**: 父节点必须在子节点前面（table → cell → text）
3. **必须删除 merge_info**: 从 markdown 转换来的 table block 如果包含 merge_info 会导致 API 报错
4. **表格行数限制**: 单次创建最多 9 行（超过需分批）

### 来源验证

从以下生产代码确认了 API 和请求体格式：

- **ztxtxwd/open-feishu-mcp-server** — `src/tools/document/table/create.ts`
- **cso1z/Feishu-MCP** — `src/services/blockFactory.ts`
- **xigua222/ObShare** — `feishu-api.ts`

---

## 四、列宽计算方案调研

分析了 20+ 项目，所有计算列宽的项目使用相同基础公式：

```
width = clamp(MIN, max_char_width × CHAR_PX, MAX)
```

| 参数 | 行业常见值 | 本项目最终值 | 说明 |
|------|-----------|-------------|------|
| CHAR_PX | 14px | 10px | 每字符宽度基数 |
| MIN | 80px | 60px | 最小列宽 |
| MAX | 400px | 360px | 最大列宽 |

### CJK 字符处理

仅 1 个项目（redleaves/feishu-mcp-server）实现了 CJK 检测。本项目也已加入：

```javascript
// 中文/日文/韩文字符算 2 倍宽度
/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char) ? 2 : 1
```

### Markdown 链接对列宽的影响

`[游戏化系统](https://feishu.cn/docx/xxx)` 在飞书里只显示"游戏化系统"，但如果用原始文本计算宽度，URL 部分会被计入导致列宽过大。

**修复**: 计算列宽前先 strip Markdown 链接语法，只保留可见文本。

---

## 五、其他调研发现

### 开源生态现状

| 方向 | 项目数量 | 代表项目 |
|------|---------|---------|
| 飞书 → Markdown | 大量 | feishu2md (Go)、feishu-backup (Python)、feishu-pages (Go) |
| Markdown → 飞书 | 极少 | 本项目 (Node.js)、java-utils (Java) |
| MCP Server | ~10 | Feishu-MCP、open-feishu-mcp-server |

### 飞书 API 限制

- 应用频率限制: 3 QPS
- 文档频率限制: 3 QPS per document
- HTTP 429 + Retry-After header
- 推荐: 指数退避重试

### Python 生态

- 官方 SDK: `lark-oapi`（PyPI）
- 无现成 Markdown → 飞书上传工具
- 若需 Python 实现，需自行开发约 800-1300 行代码

---

## 六、参考项目

| 项目 | 语言 | 方向 | 亮点 |
|------|------|------|------|
| [cso1z/Feishu-MCP](https://github.com/cso1z/Feishu-MCP) | TS | 上传 | Batch Descendants + Block Factory |
| [ztxtxwd/open-feishu-mcp-server](https://github.com/ztxtxwd/open-feishu-mcp-server) | TS | 上传 | 官方 SDK、merge_info 处理 |
| [Wsine/feishu2md](https://github.com/Wsine/feishu2md) | Go | 下载 | 最成熟的下载工具 |
| [leemysw/feishu-docx](https://github.com/leemysw/feishu-docx) | Python | 上传 | Python 参考实现（10s 等待策略） |
| [redleaves/feishu-mcp-server](https://github.com/redleaves/feishu-mcp-server) | TS | 上传 | CJK 列宽检测 |
| [larksuite/oapi-sdk-python](https://github.com/larksuite/oapi-sdk-python) | Python | SDK | 官方 Python SDK |
| [baoyudu/markdown2feishu](https://github.com/baoyudu/markdown2feishu) | Python | 上传 | 空行跳过策略 |

---

## 七、参考资料

- [飞书文档 API 概览](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview)
- [Block 数据结构](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/data-structure/block)
- [创建 Block 子节点](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document-block-children/create)
- [频率控制](https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control)
- [飞书批量上传 markdown 项目 - CSDN](https://blog.csdn.net/qq_35564244/article/details/128407227)
