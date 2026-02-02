# feishu-cli 与 FeishuFS 对比

## 概述

feishu-cli 和 [FeishuFS](https://github.com/wangjialiang678/FeishuFS) 是两个定位不同的飞书文档工具。它们共享同一套核心 API 封装和 Markdown 转换引擎，但在架构和使用场景上有明显差异。

| 维度 | feishu-cli | FeishuFS |
|------|-----------|----------|
| **定位** | 轻量 CLI 工具，按需操作 | 双向同步引擎，持续运行 |
| **操作模式** | 单次命令执行 | 后台守护进程 |
| **同步方式** | 无自动同步 | WebSocket 实时 + 轮询 + 文件监听 |
| **文档方向** | 上传创建新文档 / 下载 | 双向同步（增量更新已有文档） |
| **进程管理** | 无（每次运行即退出） | PID 文件管理，`npm start/stop` |
| **状态追踪** | 无状态 | `.feishu-sync.json` manifest |
| **冲突处理** | 不涉及 | `*.remote.md` 冲突文件 |

---

## 架构对比

### feishu-cli：无状态单次操作

```
用户 → 执行命令 → 调用飞书 API → 输出结果 → 退出
```

每次命令独立执行，不维护状态，不追踪历史。适合临时操作、脚本集成、CI/CD 流水线。

### FeishuFS：有状态持续同步

```
npm start
  → 启动 auth 守护进程（持续刷新 token）
  → 启动 sync 守护进程
      → WebSocket 监听飞书事件
      → fs.watch 监听本地文件变更
      → 可选轮询发现新文档
      → 变更处理器（去重 → 防抖 → 串行队列）
      → 双向同步执行
      → manifest 更新
```

---

## 功能对比

### feishu-cli 独有

| 功能 | 说明 |
|------|------|
| `read.js` | 文档内容直接输出到 stdout，不写文件 |
| `search.js` | 按关键词搜索飞书文档 |
| 管道支持 | `read.js` 输出可被管道到其他命令 |

### FeishuFS 独有

| 功能 | 说明 |
|------|------|
| 实时同步 | WebSocket 事件驱动的即时同步 |
| 双向同步 | 本地→远端 + 远端→本地 |
| 增量更新 | 只同步变更的文档（基于 hash 和 revisionId） |
| 冲突检测 | 双方同时修改时生成 `.remote.md` 冲突文件 |
| 轮询发现 | 可选的定时轮询，发现 WebSocket 遗漏的变更 |
| 进程管理 | `npm start/stop` 后台运行 |
| Manifest | `.feishu-sync.json` 追踪同步状态 |
| 事件去重 | 10 分钟窗口内事件 ID 去重 |
| 变更防抖 | 3 秒缓冲合并频繁变更 |
| 本地监听 | `fs.watch` 监听文件修改/创建/删除 |

### 共有功能

| 功能 | 说明 |
|------|------|
| OAuth 2.0 认证 | 相同的授权流程和 token 刷新机制 |
| 上传 Markdown | 创建飞书文档并上传内容 |
| 下载文档 | 将飞书文档转为 Markdown |
| 格式转换 | Markdown ↔ Block JSON 离线互转 |
| 列出 Wiki | 递归列出 Wiki 空间文档树 |
| 查看元数据 | 获取文档 Block JSON 结构 |
| 表格支持 | Markdown 表格 ↔ 飞书表格 |
| 限流重试 | HTTP 429 指数退避重试 |

---

## 代码关系

feishu-cli 从 FeishuFS 精简而来，两者共享核心模块：

| 模块 | feishu-cli | FeishuFS | 差异 |
|------|-----------|----------|------|
| `api/feishu.js` | ~860 行 | ~860 行 | feishu-cli 保留了同步相关函数但 CLI 脚本未使用 |
| `api/feishu-md.js` | ~1,100 行 | ~1,080 行 | 基本相同 |
| `api/helpers.js` | ~280 行 | ~280 行 | 基本相同 |
| `config.js` | ~60 行 | ~60 行 | 相同 |
| `scripts/auth.js` | ~260 行 | ~250 行 | 基本相同 |

**feishu-cli 新增**：
- `scripts/read.js` — 文档内容输出到 stdout
- `scripts/search.js` — 文档搜索
- `test/feishu-md.test.js` — 单元测试

**FeishuFS 独有**：
- `scripts/sync.js` — 实时同步守护进程
- `scripts/update.js` — 一次性全量同步
- `scripts/upload-doc.js` — 上传并更新已有文档
- `index.js` — 后台进程管理器

---

## 适用场景

### 选择 feishu-cli 的场景

- **临时操作**：偶尔上传/下载一篇文档
- **脚本集成**：在 CI/CD 或自动化脚本中调用
- **内容读取**：需要读取飞书文档内容进行处理（如 AI 总结）
- **文档搜索**：快速查找飞书中的文档
- **Claude Code 集成**：作为 Claude Code skill 被 AI 助手调用
- **低开销**：不需要后台进程，不需要配置同步目录

### 选择 FeishuFS 的场景

- **持续同步**：需要本地文件夹与飞书 Wiki 保持同步
- **团队协作**：多人编辑同一 Wiki，需要实时感知变更
- **离线编辑**：在本地编辑 Markdown，自动推送到飞书
- **文档备份**：将整个 Wiki 空间镜像到本地
- **双向更新**：需要更新已有文档（而非每次创建新文档）

---

## 配置差异

### feishu-cli 的 config.json

```json
{
  "tokenPath": "./user-token.txt",
  "wikiSpaceId": "",
  "auth": {
    "clientId": "cli_xxx",
    "clientSecret": "xxx"
  }
}
```

`sync` 配置项存在但不被 CLI 脚本使用。

### FeishuFS 的 config.json

```json
{
  "tokenPath": "./user-token.txt",
  "wikiSpaceId": "1234567890",
  "auth": {
    "clientId": "cli_xxx",
    "clientSecret": "xxx"
  },
  "sync": {
    "folderPath": "wikid",
    "pollIntervalSeconds": 30,
    "initialSync": true
  }
}
```

`sync` 配置项是 FeishuFS 同步引擎的核心配置。

---

## 总结

| | feishu-cli | FeishuFS |
|-|-----------|----------|
| **一句话** | 飞书文档的 `curl` | 飞书文档的 `rsync` |
| **复杂度** | 低 | 中高 |
| **依赖** | 相同 | 相同 |
| **上手成本** | 配置后即可使用 | 需要理解同步机制和冲突处理 |
| **资源占用** | 按需运行，无常驻进程 | 需要后台守护进程 |

两个项目可以共存使用：日常同步用 FeishuFS，临时操作和 AI 集成用 feishu-cli。
