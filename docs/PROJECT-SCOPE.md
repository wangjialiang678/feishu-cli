# feishu-cli 项目范围说明

## 概述

本文档明确说明 feishu-cli 项目包含的**所有**飞书相关文件，包括项目目录内的文件和需要部署到全局的文件。

---

## 1. 项目核心文件（Git 仓库内）

### 主要代码

```
feishu-cli/
├── package.json              # 项目依赖和脚本
├── config.js                 # 配置加载器
├── config.example.json       # 配置模板（用户需复制并填写凭证）
├── api/
│   ├── feishu.js             # 飞书 API 封装
│   ├── feishu-md.js          # Markdown ↔ 飞书 Block JSON 转换器
│   └── helpers.js            # 工具函数（token、文件名、ID 解析等）
├── scripts/
│   ├── auth.js               # OAuth 2.0 授权 + token 自动刷新
│   ├── upload.js             # 上传 Markdown → 飞书文档
│   ├── download.js           # 下载飞书文档 → Markdown
│   ├── read.js               # 读取飞书文档内容（不写文件）
│   ├── fetch.js              # 查看文档元数据
│   ├── list.js               # 列出 Wiki 空间文档
│   ├── search.js             # 搜索飞书文档
│   ├── beautify.js           # 美化飞书文档（读取/回写）
│   ├── doc-permission.js     # 文档权限管理
│   ├── verify.js             # 上传验证工具
│   ├── convert.js            # 离线格式转换
│   ├── bitable-fields.js     # 多维表格字段查看
│   ├── bitable-read.js       # 导出多维表格为 CSV
│   ├── bitable-write.js      # 从 CSV 导入多维表格
│   └── cli-utils.js          # CLI 共享工具（spinner、进度条）
└── test/
    └── feishu-md.test.js     # 单元测试
```

### 文档

```
docs/
├── technical.md                  # 技术架构文档
├── comparison-with-feishufs.md   # 与 FeishuFS 对比
└── research/                     # 技术调研报告
    ├── batch-update-cells-2026-02-03.md
    ├── table-row-append-2026-02-03.md
    └── upload-optimization-2026-02-03.md
```

### 根目录文件

```
README.md                # 项目主文档（使用指南、部署步骤）
CHANGELOG.md             # 版本变更记录
```

### 排除文件（.gitignore）

以下文件**不属于** feishu-cli 项目，不会同步到 GitHub：

```
config.json              # 用户的飞书应用凭证（敏感信息）
user-token.txt           # OAuth token（敏感信息）
AGENTS.md                # 掌天瓶代理注册表（属于掌天瓶系统）
.claude/                 # 掌天瓶项目级配置（属于掌天瓶系统）
.orchestrator/           # 掌天瓶编排系统（属于掌天瓶系统）
node_modules/            # 依赖包
```

---

## 2. 飞书专用全局配置（不在 Git 仓库内）

这些文件需要手动部署到用户的全局 Claude Code 配置目录。

### 2.1 feishu-doc Skill

**位置：** `~/.claude/skills/feishu-doc/SKILL.md`

**作用：** 让 Claude Code 识别飞书相关指令，自动调用 feishu-cli 脚本。

**内容来源：** 项目 README.md 中的 "Claude Code Skill 生成" 章节。

**触发条件：** 用户提到"飞书"、"feishu"、"lark"、读取/上传/下载/美化飞书文档、修改飞书权限等关键词。

**功能：**
- 上传本地 Markdown 到飞书文档
- 读取/下载飞书文档
- 搜索飞书文档
- 美化飞书文档
- 管理文档权限
- 多维表格操作
- 离线格式转换

### 2.2 全局权限预设（可选）

**位置：** `~/.claude/settings.json` 或 `<项目>/.claude/settings.local.json`

**作用：** 预先允许 feishu-cli 相关命令，减少权限确认提示。

**示例配置：**

```json
{
  "permissions": {
    "allow": [
      "Bash(cd ~/projects/feishu-cli && node scripts/upload.js:*)",
      "Bash(cd ~/projects/feishu-cli && node scripts/read.js:*)",
      "Bash(cd ~/projects/feishu-cli && node scripts/download.js:*)",
      "Bash(cd ~/projects/feishu-cli && node scripts/search.js:*)",
      "Bash(cd ~/projects/feishu-cli && node scripts/beautify.js:*)",
      "Bash(cd ~/projects/feishu-cli && node scripts/doc-permission.js:*)",
      "Bash(cd ~/projects/feishu-cli && npm run auth:*)"
    ]
  }
}
```

**注意：** 这不是必需的，但可以提升使用体验。

---

## 3. 部署后的完整目录结构

用户克隆并配置项目后，相关文件分布如下：

```
# 项目目录
~/projects/feishu-cli/
├── [项目核心文件]（见第 1 节）
├── config.json                      # 用户创建的飞书应用凭证
└── user-token.txt                   # auth.js 自动生成的 token

# 全局 Claude Code 配置
~/.claude/
├── skills/
│   └── feishu-doc/
│       └── SKILL.md                 # 飞书 skill（用户手动部署）
└── settings.json                    # 可选：添加权限预设
```

---

## 4. 非项目内容（本地可能存在但不属于 feishu-cli）

以下内容可能存在于你的开发环境，但**不属于 feishu-cli 项目**，不应提交到 Git：

### 4.1 掌天瓶系统文件

```
feishu-cli/.claude/                  # 掌天瓶项目级配置
feishu-cli/.orchestrator/            # 掌天瓶编排系统
feishu-cli/AGENTS.md                 # 掌天瓶代理注册表
```

这些是用于**开发 feishu-cli 项目本身**的工具，不是 feishu-cli 的功能组成部分。

### 4.2 通用全局配置（不是飞书专用）

```
~/.claude/hooks/                     # 通用 hooks（经验学习系统）
~/.claude/agents/                    # 通用 agents（researcher, reviewer 等）
```

这些是你的个人全局开发环境配置，与飞书无关。

---

## 5. 部署清单

同事在新环境部署 feishu-cli 时，需要完成以下步骤：

### 5.1 项目部署

```bash
# 1. 克隆项目
git clone <repo-url> ~/projects/feishu-cli
cd ~/projects/feishu-cli

# 2. 安装依赖
npm install

# 3. 创建配置文件
cp config.example.json config.json
# 编辑 config.json，填入飞书应用凭证（App ID 和 App Secret）

# 4. OAuth 授权
npm run auth
# 浏览器打开授权页面，登录并同意授权
```

### 5.2 Claude Code Skill 部署

**方式 1：手动创建**

```bash
mkdir -p ~/.claude/skills/feishu-doc
# 将 README.md 中 "Claude Code Skill 生成" 章节的内容
# 复制到 ~/.claude/skills/feishu-doc/SKILL.md
```

**方式 2：通过 Claude Code 自动创建**

在 Claude Code 中输入：
```
请读取 ~/projects/feishu-cli/README.md，按照其中的 "Claude Code Skill 生成" 章节，创建 feishu-doc skill。
```

### 5.3 可选：权限预设

在 `~/.claude/settings.json` 中添加飞书命令的权限预设（见第 2.2 节）。

---

## 6. 验证部署

部署完成后，在 Claude Code 中测试：

```
上传 ~/docs/test.md 到飞书
```

如果 Claude Code 自动调用 `feishu-cli` 并成功上传，说明部署成功。

---

## 7. 项目范围总结

### ✅ 属于 feishu-cli 项目的：

- 项目代码（api/, scripts/, test/）
- 项目文档（README.md, docs/）
- 配置模板（config.example.json）
- 全局 feishu-doc skill（部署目标）

### ❌ 不属于 feishu-cli 项目的：

- 掌天瓶系统文件（AGENTS.md, .claude/, .orchestrator/）
- 通用全局 hooks（context_injector.py, auto_decision.py 等）
- 通用全局 agents（researcher.md, reviewer.md 等）
- 用户凭证（config.json, user-token.txt）

---

## 8. 常见问题

**Q: 为什么项目里有 `.claude/` 目录？**
A: 那是开发项目时使用的掌天瓶系统配置，已在 `.gitignore` 中排除，不会同步到 GitHub。

**Q: 同事需要安装掌天瓶系统吗？**
A: 不需要。同事只需要安装 feishu-doc skill，即可在 Claude Code 中使用飞书功能。

**Q: 全局 hooks 和 agents 是必需的吗？**
A: 不是。它们是通用的开发环境增强工具，与飞书功能无关。

**Q: 如何确认部署成功？**
A: 在 Claude Code 中说"上传这个 MD 到飞书"，如果能自动调用 feishu-cli 就成功了。
