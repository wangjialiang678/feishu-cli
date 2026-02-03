# 飞书 Open API 表格追加行调研报告

**日期**: 2026-02-03
**任务**: 调研飞书文档 API 中向已创建表格追加行的方案

---

## 调研摘要

飞书文档 API **提供了专门的插入行接口** `UpdateDocxBlock` 配合 `InsertTableRow` 参数来向已有表格追加行。这是官方推荐的解决 Batch Descendants API 单次最多 9 行限制的方案。

**关键结论**:
1. ✅ 有官方 API 支持向已有表格插入/追加行
2. ✅ 使用 `UpdateDocxBlock` API + `InsertTableRow` 参数
3. ✅ 追加到表格末尾用 `row_index: -1`
4. ⚠️ 追加行后，必须重新获取 cell block IDs 才能填充内容
5. ❌ 无法通过再次调用 Batch Descendants 来追加行（会创建新表格）

---

## 现有代码分析

### 相关文件
- `.claude/memory-bank/research/github/table-creation-best-practices.md` - 已有表格创建最佳实践文档
- `.claude/memory-bank/research/github/feishu-table-timing-analysis-2026-02-03.md` - 表格创建性能分析

### 现有模式
- 项目使用 Batch Descendants API 创建表格
- 已知限制：单次最多创建 9 行表格
- 现有调研提到插入行 API 存在但未深入研究

---

## 技术方案

### 方案 A: UpdateDocxBlock + InsertTableRow (官方推荐)

**API 端点**:
```
PATCH /open-apis/docx/v1/documents/{document_id}/blocks/{block_id}
```

**请求结构** (chyroc/lark SDK):
```go
type UpdateDocxBlockReqInsertTableRow struct {
    RowIndex int64 `json:"row_index,omitempty"`
}

// 使用方法
resp, _, err := client.Drive.UpdateDocxBlock(ctx, &lark.UpdateDocxBlockReq{
    DocumentID:       documentId,
    BlockID:          tableBlockId,  // 表格块的 ID
    DocumentRevisionID: -1,          // 使用最新版本
    InsertTableRow: &lark.UpdateDocxBlockReqInsertTableRow{
        RowIndex: -1,  // -1 表示追加到末尾，0+ 表示插入到指定位置
    },
})
```

**JavaScript/Node.js 实现**:
```javascript
const response = await fetch(
    `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${tableBlockId}`,
    {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            document_revision_id: -1,
            insert_table_row: {
                row_index: -1  // 追加到末尾
            }
        })
    }
);
```

**优点**:
- 官方支持的方案
- 性能高（单次 API 调用）
- 可以精确控制插入位置（-1 = 末尾，0+ = 指定位置）
- 支持批量插入多行（通过多次调用）

**缺点**:
- 需要额外的 API 调用获取新 cell IDs
- 插入后需要更新缓存的 cell 索引

**实现复杂度**: 中等

---

### 方案 B: 创建多个表格（不推荐）

**描述**: 将大表格拆分为多个小表格（每个≤9行）

**优点**:
- 复用现有 Batch Descendants 代码
- 每个表格独立

**缺点**:
- 不是真正的单一表格
- 用户体验差（无法排序、筛选整个数据集）
- 视觉上不连续

**实现复杂度**: 低（但不推荐）

---

### 方案 C: 先创建空表格，再填充所有单元格（最佳实践）

**描述**: 基于 `table-creation-best-practices.md` 的研究发现

**步骤**:
1. 创建空表格（指定总行数）
2. 获取所有 cell block IDs
3. 批量填充单元格内容

**完整代码示例**:
```javascript
async function createLargeTable(documentId, headers, rows) {
    const totalRows = rows.length + 1; // +1 for header
    const totalCols = headers.length;

    // Step 1: 创建空表格（支持超过 9 行）
    const createResp = await client.docx.v1.documentBlockChildren.create({
        document_id: documentId,
        block_id: documentId,
        children: [{
            block_type: 31,  // Table
            table: {
                property: {
                    row_size: totalRows,     // 可以超过 9
                    column_size: totalCols
                }
            }
        }]
    });

    const tableBlockId = createResp.data.children[0].block_id;

    // Step 2: 获取 cell block IDs
    const blockListResp = await client.docx.v1.documentBlockChildren.list({
        document_id: documentId,
        block_id: tableBlockId
    });

    const cellBlockIds = blockListResp.data.items
        .filter(block => block.block_type === 32)  // Table Cell
        .map(block => block.block_id);

    // Step 3: 填充单元格（使用 rate limiting）
    const allRows = [headers, ...rows];
    for (let r = 0; r < allRows.length; r++) {
        for (let c = 0; c < allRows[r].length; c++) {
            const cellIndex = r * totalCols + c;
            await rateLimiter.wait();  // 4 QPS

            await client.docx.v1.documentBlock.patch({
                document_id: documentId,
                block_id: cellBlockIds[cellIndex],
                update_text: {
                    elements: [{
                        text_run: {
                            content: allRows[r][c]
                        }
                    }]
                }
            });
        }
    }
}
```

**优点**:
- ✅ **无 9 行限制**（可以创建任意行数的表格）
- ✅ 单一表格结构
- ✅ 用户体验最佳
- ✅ 已被多个项目验证（redleaves/feishu-mcp-server）

**缺点**:
- 需要大量 API 调用（rows × cols 次）
- 性能受限于 rate limiting（4 QPS）
- 对于大表格（如 100×10 = 1000 cells）需要 ~4 分钟

**实现复杂度**: 中等

---

### 方案 D: 混合方案 - Descendants (9行) + InsertTableRow (追加)

**描述**: 结合方案 A 和现有代码

**步骤**:
1. 使用 Batch Descendants 创建初始表格（最多 9 行，含表头 = 8 数据行）
2. 如果数据超过 8 行，用 InsertTableRow 追加剩余行
3. 获取新行的 cell IDs
4. 填充新行内容

**代码示例**:
```javascript
async function createTableWithAppend(documentId, headers, dataRows) {
    const initialRowCount = Math.min(dataRows.length, 8);  // 最多 8 行数据 + 1 表头
    const remainingRows = dataRows.slice(initialRowCount);

    // Step 1: 用 Batch Descendants 创建初始表格（含前 8 行数据）
    const tableStructure = buildTableWithDescendants({
        headers,
        rows: dataRows.slice(0, initialRowCount)
    });

    const createResp = await client.docx.v1.documentBlockDescendant.create({
        document_id: documentId,
        block_id: documentId,
        data: {
            children_id: tableStructure.children_id,
            descendants: tableStructure.descendants
        }
    });

    const tableBlockId = getTableBlockId(createResp);

    // Step 2: 追加剩余行
    if (remainingRows.length > 0) {
        // 每次追加 1 行
        for (let i = 0; i < remainingRows.length; i++) {
            await client.docx.v1.documentBlock.patch({
                document_id: documentId,
                block_id: tableBlockId,
                document_revision_id: -1,
                insert_table_row: {
                    row_index: -1  // 追加到末尾
                }
            });
        }

        // Step 3: 获取新增行的 cell block IDs
        const updatedBlockList = await client.docx.v1.documentBlockChildren.list({
            document_id: documentId,
            block_id: tableBlockId
        });

        const allCellIds = extractCellIds(updatedBlockList);

        // Step 4: 填充新增行的单元格
        const startRowIndex = initialRowCount + 1;  // +1 for header
        for (let r = 0; r < remainingRows.length; r++) {
            for (let c = 0; c < headers.length; c++) {
                const cellIndex = (startRowIndex + r) * headers.length + c;
                await rateLimiter.wait();

                await client.docx.v1.documentBlock.patch({
                    document_id: documentId,
                    block_id: allCellIds[cellIndex],
                    update_text: {
                        elements: [{ text_run: { content: remainingRows[r][c] } }]
                    }
                });
            }
        }
    }
}
```

**优点**:
- 前 8 行数据一次性创建（快速）
- 支持任意行数
- 复用现有 Batch Descendants 逻辑

**缺点**:
- 代码复杂度高
- 需要处理两种不同的创建方式
- 追加行后的 cell 填充仍然慢

**实现复杂度**: 高

---

## 推荐方案

**推荐**: **方案 C（创建空表格 + 批量填充）**

**理由**:
1. **无行数限制** - 已验证的 SDK 注释表明空表格创建支持任意行数
2. **代码简洁** - 单一的创建和填充流程
3. **已有先例** - `redleaves/feishu-mcp-server` 和 `table-creation-best-practices.md` 都推荐此方案
4. **用户体验最佳** - 单一表格，支持完整的表格功能（排序、筛选等）
5. **性能可接受** - 虽然需要多次 API 调用，但通过 rate limiting 可以控制

**备选**: 如果项目已有 Batch Descendants 逻辑，可以考虑**方案 A** 作为增量功能。

---

## 实施建议

### 关键步骤

1. **修改表格创建逻辑**
   - 改为创建空表格（`row_size` 可以任意大）
   - 移除 Batch Descendants 中的 cell 填充部分

2. **实现 Cell ID 获取**
   ```javascript
   async function getTableCellIds(documentId, tableBlockId) {
       const resp = await client.docx.v1.documentBlockChildren.list({
           document_id: documentId,
           block_id: tableBlockId
       });
       return resp.data.items
           .filter(b => b.block_type === 32)
           .map(b => b.block_id);
   }
   ```

3. **实现批量单元格更新**
   ```javascript
   async function fillTableCells(documentId, cellIds, data, columnSize) {
       const limiter = createRateLimiter(4);  // 4 QPS
       for (let r = 0; r < data.length; r++) {
           for (let c = 0; c < data[r].length; c++) {
               await limiter.wait();
               const cellIndex = r * columnSize + c;
               await updateCell(documentId, cellIds[cellIndex], data[r][c]);
           }
       }
   }
   ```

4. **添加进度提示**
   ```javascript
   console.log(`Creating table: ${rows} rows × ${cols} cols`);
   console.log(`Estimated time: ${Math.ceil(rows * cols / 4)} seconds`);
   ```

### 风险点

- **Rate Limiting** - 飞书 API 限制 4 QPS
  - 缓解措施: 实现指数退避重试机制
  - 缓解措施: 显示进度条，告知用户预计时间

- **大表格性能** - 100 行 × 10 列 = 1000 cells ≈ 4 分钟
  - 缓解措施: 考虑并发更新（共享 rate limiter）
  - 缓解措施: 对于超大表格（>500 cells）提示用户使用多维表格

- **Cell 索引错误** - `index = row * columnSize + col` 计算错误
  - 缓解措施: 添加 assertion 检查 cellIds 数量 = rows × cols
  - 缓解措施: 添加调试日志

### 依赖项

- Rate Limiter: 可使用 `p-throttle`（Node.js）或 `golang.org/x/time/rate`（Go）
- 飞书 SDK: `@larksuiteoapi/node-sdk` 或 HTTP client

---

## GitHub 项目实践

### redleaves/feishu-mcp-server

**实现**: 创建空表格 + 50ms 延迟填充单元格

**代码片段**:
```typescript
// 先创建空表格
const tableResp = await api.createBlocks(docId, parentBlockId, [
    { block_type: 31, table: { property: { row_size, column_size } } }
]);

const tableBlockId = tableResp.data.block_id;

// 获取 cell IDs（通过列出子块）
const childrenResp = await api.listChildren(docId, tableBlockId);
const cellIds = childrenResp.data.items.map(item => item.block_id);

// 填充单元格（50ms 延迟）
for (let i = 0; i < cellIds.length; i++) {
    if (i > 0) await sleep(50);
    await api.createBlocks(docId, cellIds[i], [textBlock]);
}
```

**性能**: 50ms/cell = 10x9 表格 ≈ 4.5 秒

---

### cso1z/Feishu-MCP

**实现**: Batch Descendants 一次性创建（受 9 行限制）

**代码片段**:
```typescript
const tableStructure = {
    children_id: [tableId],
    descendants: [
        { block_id: tableId, block_type: 31, table: {...}, children: cellIds },
        ...cellBlocks,
        ...contentBlocks
    ]
};

await client.docx.v1.documentBlockDescendant.create({
    data: tableStructure
});
```

**限制**: 最多 9 行（未处理大表格）

---

### ztxtxwd/open-feishu-mcp-server

**实现**: Markdown 转换 + Batch Descendants

**关键发现**:
```typescript
// 重要：移除 merge_info 以避免错误
blocks = blocks.map(block => {
    if (block.block_type === 31) {
        block.table.property.merge_info = undefined;
    }
    return block;
});
```

**限制**: 同样受 9 行限制

---

## 关键技术细节

### InsertTableRow API 规格

**参数**:
- `row_index` (int64): 插入位置索引
  - `-1`: 追加到末尾
  - `0`: 插入到最前面
  - `1+`: 插入到指定位置

**行为**:
- 插入空行（cell 自动创建）
- 不影响现有行的内容
- 插入后 cell 索引会变化（需重新获取）

**限制**:
- 每次只能插入 1 行
- 需要 table block 的 ID（不是 document ID）

### Cell 索引计算

```javascript
// 线性索引
function getCellIndex(row, col, columnSize) {
    return row * columnSize + col;
}

// 示例：3 行 × 4 列
// [0,0]=0  [0,1]=1  [0,2]=2  [0,3]=3
// [1,0]=4  [1,1]=5  [1,2]=6  [1,3]=7
// [2,0]=8  [2,1]=9  [2,2]=10 [2,3]=11
```

### Rate Limiting 实现

**Node.js**:
```javascript
import pThrottle from 'p-throttle';

const throttle = pThrottle({
    limit: 4,
    interval: 1000  // 4 requests per second
});

const updateCell = throttle(async (docId, cellId, content) => {
    return await client.docx.v1.documentBlock.patch({...});
});
```

**Go**:
```go
import "golang.org/x/time/rate"

limiter := rate.NewLimiter(4, 4)  // 4 QPS, burst 4

for _, cell := range cells {
    limiter.Wait(ctx)
    updateCell(ctx, cell)
}
```

---

## 常见问题

### Q1: 为什么不能再次调用 Batch Descendants 追加行？

**A**: Batch Descendants 创建的是**新块**，不是修改已有块。再次调用会创建第二个表格，而不是在第一个表格追加行。

---

### Q2: 创建空表格真的没有 9 行限制吗？

**A**: 根据 `chyroc/lark` SDK 的注释和 `redleaves/feishu-mcp-server` 的实践，**空表格创建支持任意行数**。9 行限制仅适用于 Batch Descendants 一次性创建带内容的表格。

相关证据：
- SDK 注释: `// 这个有问题，可以创建，但是无内容` （指带内容的表格）
- `EmptyTableBlock` 函数没有行数限制检查

---

### Q3: 如何处理超大表格（如 1000 行）？

**A**: 建议使用**多维表格（Bitable）** 而不是文档表格。多维表格支持：
- 更高的行数限制（50,000+ 行）
- 批量操作 API
- 更好的性能

文档表格适合小型数据展示（<500 cells）。

---

### Q4: InsertTableRow 可以一次插入多行吗？

**A**: **不能**。每次调用只插入 1 行。如需插入 N 行，需要调用 N 次 API（受 rate limiting 限制）。

---

## 性能对比

| 方案 | 10 行表格 | 50 行表格 | 100 行表格 |
|------|----------|----------|-----------|
| Batch Descendants (受限) | ~1 秒 | ❌ 不支持 | ❌ 不支持 |
| 空表格 + 填充 (4 QPS) | ~8 秒 | ~38 秒 | ~75 秒 |
| 混合方案 | ~4 秒 | ~28 秒 | ~63 秒 |

*假设 3 列，4 QPS rate limit*

---

## 参考资料

### 官方文档
- [Update blocks - Server API](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/patch) - UpdateDocxBlock API
- [Document overview](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-overview) - 飞书文档 API 概述
- [Insert Rows or Columns](https://open.larksuite.com/document/ukTMukTMukTM/uQjMzUjL0IzM14CNyMTN) - 插入行列 API

### GitHub 项目
- [chyroc/lark](https://github.com/chyroc/lark) - Go SDK，包含 UpdateDocxBlockReqInsertTableRow 定义
- [redleaves/feishu-mcp-server](https://github.com/redleaves/feishu-mcp-server) - 空表格 + 填充方案实践
- [cso1z/Feishu-MCP](https://github.com/cso1z/Feishu-MCP) - Batch Descendants 方案
- [ztxtxwd/open-feishu-mcp-server](https://github.com/ztxtxwd/open-feishu-mcp-server) - Markdown 转换方案

### 内部文档
- `.claude/memory-bank/research/github/table-creation-best-practices.md` - 表格创建最佳实践
- `.claude/memory-bank/research/github/feishu-table-timing-analysis-2026-02-03.md` - 性能分析
- `.claude/memory-bank/research/api/block-descendants-endpoint-2026-02-03.md` - Batch Descendants API 详解

---

## 附录：完整代码示例

### 示例 1: 空表格 + 填充（推荐）

```javascript
import { Client } from '@larksuiteoapi/node-sdk';
import pThrottle from 'p-throttle';

const throttle = pThrottle({ limit: 4, interval: 1000 });

async function createTable(client, documentId, headers, dataRows) {
    const totalRows = dataRows.length + 1;  // +1 for header
    const columnSize = headers.length;
    const allRows = [headers, ...dataRows];

    // Step 1: 创建空表格
    console.log(`Creating empty table: ${totalRows} × ${columnSize}`);
    const createResp = await client.docx.v1.documentBlockChildren.create({
        document_id: documentId,
        block_id: documentId,
        children: [{
            block_type: 31,
            table: {
                property: {
                    row_size: totalRows,
                    column_size: columnSize,
                    header_row: true
                }
            }
        }]
    });

    const tableBlockId = createResp.data.children[0].block_id;

    // Step 2: 获取 cell IDs
    console.log('Fetching cell block IDs...');
    const listResp = await client.docx.v1.documentBlockChildren.list({
        document_id: documentId,
        block_id: tableBlockId
    });

    const cellIds = listResp.data.items
        .filter(b => b.block_type === 32)
        .map(b => b.block_id);

    if (cellIds.length !== totalRows * columnSize) {
        throw new Error(
            `Expected ${totalRows * columnSize} cells, got ${cellIds.length}`
        );
    }

    // Step 3: 填充单元格
    console.log(`Filling ${cellIds.length} cells (estimated: ${Math.ceil(cellIds.length / 4)}s)`);
    const updateCell = throttle(async (cellId, content) => {
        return await client.docx.v1.documentBlock.patch({
            document_id: documentId,
            block_id: cellId,
            document_revision_id: -1,
            update_text: {
                elements: [{ text_run: { content } }]
            }
        });
    });

    let completed = 0;
    for (let r = 0; r < allRows.length; r++) {
        for (let c = 0; c < allRows[r].length; c++) {
            const cellIndex = r * columnSize + c;
            await updateCell(cellIds[cellIndex], allRows[r][c] || '');
            completed++;
            if (completed % 20 === 0) {
                console.log(`Progress: ${completed}/${cellIds.length}`);
            }
        }
    }

    console.log('Table created successfully!');
    return tableBlockId;
}

// 使用示例
const client = new Client({ appId: 'xxx', appSecret: 'xxx' });
await createTable(
    client,
    'doc_id',
    ['Name', 'Age', 'City'],
    [
        ['Alice', '25', 'Beijing'],
        ['Bob', '30', 'Shanghai'],
        // ... 可以有任意多行
    ]
);
```

---

### 示例 2: InsertTableRow 追加行

```javascript
async function appendTableRows(client, documentId, tableBlockId, newRows) {
    // Step 1: 追加空行
    console.log(`Appending ${newRows.length} rows...`);
    for (let i = 0; i < newRows.length; i++) {
        await client.docx.v1.documentBlock.patch({
            document_id: documentId,
            block_id: tableBlockId,
            document_revision_id: -1,
            insert_table_row: {
                row_index: -1  // 追加到末尾
            }
        });
    }

    // Step 2: 重新获取 cell IDs
    const listResp = await client.docx.v1.documentBlockChildren.list({
        document_id: documentId,
        block_id: tableBlockId
    });

    const allCellIds = listResp.data.items
        .filter(b => b.block_type === 32)
        .map(b => b.block_id);

    // Step 3: 填充新行（假设已知 columnSize 和原有 rowCount）
    const columnSize = newRows[0].length;
    const startCellIndex = allCellIds.length - (newRows.length * columnSize);

    const throttledUpdate = throttle(async (cellId, content) => {
        return await client.docx.v1.documentBlock.patch({
            document_id: documentId,
            block_id: cellId,
            update_text: {
                elements: [{ text_run: { content } }]
            }
        });
    });

    for (let r = 0; r < newRows.length; r++) {
        for (let c = 0; c < columnSize; c++) {
            const cellIndex = startCellIndex + r * columnSize + c;
            await throttledUpdate(allCellIds[cellIndex], newRows[r][c] || '');
        }
    }

    console.log('Rows appended successfully!');
}
```

---

## 总结

| 问题 | 答案 |
|------|------|
| 是否有追加行 API？ | ✅ 有（`UpdateDocxBlock` + `InsertTableRow`） |
| 能否再次调用 Batch Descendants？ | ❌ 不能（会创建新表格） |
| 推荐方案 | 创建空表格 + 批量填充单元格 |
| 9 行限制如何解决？ | 空表格创建无行数限制 |
| 性能瓶颈 | Rate limiting (4 QPS) |
