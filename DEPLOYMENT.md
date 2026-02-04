# feishu-cli 自动化部署指南

> **本文档专为 Claude Code 设计。**
> 当用户说"帮我下载 GitHub 项目并完成自动部署"时，Claude Code 应按本指南执行所有步骤。

---

## 部署概述

本项目需要完成以下部署：
1. ✅ 克隆 Git 仓库到本地
2. ✅ 安装项目依赖
3. ✅ 配置飞书应用凭证
4. ✅ 部署全局 Claude Code Skill
5. ✅ （可选）配置权限预设
6. ✅ 运行 OAuth 授权
7. ✅ 验证部署成功

---

## 前置条件检查

在开始部署前，Claude Code 应自动检查以下环境：

### 必需环境

```bash
# 检查 Node.js 版本（需要 18+）
node --version

# 检查 npm
npm --version

# 检查 git
git --version
```

**如果缺少任何环境，提示用户安装后再继续。**

### 可选：检查飞书应用凭证

询问用户：
- ✅ 是否已在飞书开放平台创建应用？
- ✅ 是否已获取 App ID 和 App Secret？
- ✅ 是否已配置 OAuth 重定向 URL：`http://localhost:7777/callback`？
- ✅ 是否已开通必需权限（docx:document, drive:drive, offline_access 等）？

如果用户回答"否"，提供飞书应用配置指南链接（见 README.md 第 2 节）。

---

## 步骤 1：克隆项目

### 1.1 检查项目是否已存在

```bash
ls ~/projects/feishu-cli
```

**分支逻辑：**
- 如果目录已存在 → 询问用户是否覆盖或更新
  - 覆盖：`rm -rf ~/projects/feishu-cli && git clone <repo-url> ~/projects/feishu-cli`
  - 更新：`cd ~/projects/feishu-cli && git pull`
- 如果不存在 → 直接克隆

### 1.2 克隆仓库

```bash
git clone <repo-url> ~/projects/feishu-cli
cd ~/projects/feishu-cli
```

**替换说明：** `<repo-url>` 应替换为实际的 GitHub 仓库地址。

### 1.3 验证克隆成功

```bash
ls package.json api/ scripts/
```

预期输出应包含 `package.json`、`api/` 目录、`scripts/` 目录。

---

## 步骤 2：安装依赖

```bash
cd ~/projects/feishu-cli
npm install
```

**验证：** 检查 `node_modules/` 目录是否创建成功。

---

## 步骤 3：配置飞书应用凭证

### 3.1 询问用户凭证

使用 `AskUserQuestion` 工具询问用户：
- **App ID**（格式：`cli_xxxxxxxxxxxx`）
- **App Secret**（长字符串）

**注意：** 如果用户不知道凭证在哪里，提示访问 [飞书开放平台](https://open.feishu.cn/app) → 应用详情 → 凭证与基础信息。

### 3.2 创建 config.json

读取 `config.example.json` 模板：

```bash
cat config.example.json
```

基于模板创建 `config.json`，填入用户提供的凭证：

```json
{
  "tokenPath": "./user-token.txt",
  "wikiSpaceId": "",
  "auth": {
    "clientId": "<用户提供的App ID>",
    "clientSecret": "<用户提供的App Secret>"
  }
}
```

**重要：**
- `tokenPath` 保持默认值 `./user-token.txt`
- `wikiSpaceId` 留空（用户后续需要时可手动添加）
- 使用 `Write` 工具创建文件，不要使用 `echo` 或 `cat`

### 3.3 验证配置文件

```bash
cat config.json | grep -E "clientId|clientSecret"
```

确认文件存在且包含凭证（不显示完整内容以保护隐私）。

---

## 步骤 4：部署全局 Skill

### 4.1 读取 Skill 内容

**来源：** 项目 README.md 中 "Claude Code Skill 生成" 章节（第 454-637 行）。

**方式 1（推荐）：** 直接从 README.md 提取：

```bash
# Claude Code 应使用 Read 工具读取以下内容
cat ~/projects/feishu-cli/README.md
```

提取 ` ````markdown` 标记之间的内容（第 458-637 行）。

**方式 2：** 从项目内 `.claude/skills/feishu-doc/SKILL.md` 读取（如果存在）。

### 4.2 创建全局 Skill 目录

```bash
mkdir -p ~/.claude/skills/feishu-doc
```

### 4.3 写入 Skill 文件

使用 `Write` 工具将 Skill 内容写入：

**目标路径：** `~/.claude/skills/feishu-doc/SKILL.md`

**内容：** README.md 第 458-637 行之间的完整 Markdown 内容（包括 frontmatter）。

**示例结构：**

```markdown
---
name: feishu-doc
description: 飞书文档 CLI 工具。上传本地 Markdown 到飞书文档、读取/下载/美化飞书文档、管理文档权限。当用户提到"飞书"、"feishu"、"lark"、读取/上传/下载/美化飞书文档、修改飞书权限时自动触发。
---

# 飞书文档 CLI (feishu-cli)

基于 OAuth 2.0 user_access_token，以用户身份操作飞书文档。

[完整内容见 README.md]
```

### 4.4 验证 Skill 部署

```bash
ls ~/.claude/skills/feishu-doc/SKILL.md
cat ~/.claude/skills/feishu-doc/SKILL.md | head -20
```

确认文件存在且包含正确的 frontmatter。

---

## 步骤 5：配置权限预设（可选）

### 5.1 询问用户

询问用户是否需要配置权限预设（减少命令确认提示）。

**说明：** 这会在全局 `settings.json` 中添加飞书命令的自动允许规则。

### 5.2 检查现有配置

```bash
cat ~/.claude/settings.json
```

**注意：** 需要使用 JSON 合并逻辑，不能直接覆盖用户现有配置。

### 5.3 合并权限配置

读取现有 `~/.claude/settings.json`，在 `permissions.allow` 数组中添加：

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
      "Bash(cd ~/projects/feishu-cli && node scripts/verify.js:*)",
      "Bash(cd ~/projects/feishu-cli && npm run auth:*)"
    ]
  }
}
```

**重要：** 使用智能合并，保留用户原有的权限配置。

### 5.4 或使用项目级配置（推荐）

如果不想修改全局配置，可以在项目级创建：

**目标路径：** `~/projects/feishu-cli/.claude/settings.local.json`

```bash
mkdir -p ~/projects/feishu-cli/.claude
```

写入权限配置到项目级 `settings.local.json`。

---

## 步骤 6：运行 OAuth 授权

### 6.1 启动授权服务器

在后台启动授权进程：

```bash
cd ~/projects/feishu-cli
npm run auth > /dev/null 2>&1 &
```

**预期行为：**
- 浏览器会自动打开飞书授权页面
- 终端会显示授权 URL（如果浏览器未自动打开）

### 6.2 提示用户

告知用户：
```
✅ 飞书授权页面已在浏览器中打开（如果未打开，请手动访问终端显示的 URL）

请按以下步骤操作：
1. 登录你的飞书账号
2. 点击"同意授权"
3. 授权成功后，浏览器会显示"授权成功"页面
4. 回到 Claude Code，告诉我"授权完成"

📝 注意：auth 进程会持续运行以自动刷新 token（建议保持运行）。
      如需关闭，可使用 Ctrl+C 或运行 `pkill -f "npm run auth"`。
```

### 6.3 等待用户确认

等待用户明确说"授权完成"或"好了"后，再继续下一步。

### 6.4 验证 token 文件

```bash
ls user-token.txt
cat user-token.txt | head -3
```

确认 `user-token.txt` 已创建且包含 JSON 格式的 token 数据。

---

## 步骤 7：验证部署

### 7.1 测试基础功能

尝试读取一个已知的飞书文档（如果用户没有，跳过此测试）：

```bash
cd ~/projects/feishu-cli
node scripts/search.js "测试" 2>&1 | head -10
```

**预期结果：**
- 如果 token 有效，应返回搜索结果或"未找到文档"
- 如果报错"token 过期"，说明授权步骤未完成

### 7.2 Claude Code Skill 测试

告知用户进行最终测试：

```
🎉 部署基本完成！请尝试以下测试命令：

1. 在 Claude Code 中输入：
   "上传 ~/projects/feishu-cli/README.md 到飞书"

2. 观察是否自动调用 feishu-cli 脚本

3. 如果成功创建飞书文档并返回 URL，说明部署完全成功 ✅

如果出现权限提示，请选择"允许"。
```

### 7.3 输出部署报告

生成部署摘要：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  feishu-cli 部署完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 项目已克隆到：~/projects/feishu-cli
✅ 依赖已安装
✅ 飞书应用凭证已配置
✅ Claude Code Skill 已部署到：~/.claude/skills/feishu-doc/
✅ OAuth 授权已完成
✅ Token 已保存到：user-token.txt

📚 可用功能：
  - 上传 Markdown 到飞书
  - 下载/读取飞书文档
  - 搜索飞书文档
  - 美化飞书文档
  - 管理文档权限
  - 多维表格操作

📖 详细文档：~/projects/feishu-cli/README.md
🔧 项目范围说明：~/projects/feishu-cli/docs/PROJECT-SCOPE.md

💡 使用示例：
  "上传 report.md 到飞书"
  "下载这个飞书文档 https://feishu.cn/docx/xxx"
  "在飞书上搜索包含 XX 的文档"

⚠️  注意事项：
  - auth 进程需保持运行以自动刷新 token
  - 如果 token 过期，重新运行：cd ~/projects/feishu-cli && npm run auth
  - 更多帮助见 README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 错误处理

### 常见问题及解决方案

#### 1. Node.js 版本过低

**错误：** `npm install` 失败，提示 "Unsupported engine"

**解决：** 提示用户升级 Node.js 到 18+：
```bash
# macOS
brew install node@18

# 或使用 nvm
nvm install 18
nvm use 18
```

#### 2. 飞书应用未配置

**错误：** 授权时提示"应用未开通网页能力"或"重定向 URL 不匹配"

**解决：** 引导用户完成飞书应用配置（见 README.md 第 2 节）。

#### 3. Token 获取失败

**错误：** `user-token.txt` 未创建或为空

**解决：**
1. 确认 `config.json` 中凭证正确
2. 重新运行 `npm run auth`
3. 检查飞书应用权限是否完整（需要 offline_access）

#### 4. Skill 未生效

**错误：** Claude Code 无法识别飞书相关指令

**解决：**
1. 确认 `~/.claude/skills/feishu-doc/SKILL.md` 存在
2. 检查文件是否包含正确的 frontmatter（name 和 description）
3. 重启 Claude Code
4. 尝试明确触发："使用 feishu-doc skill 上传文件"

#### 5. 权限持续提示

**错误：** 每次运行命令都要求确认权限

**解决：**
1. 检查是否配置了权限预设（步骤 5）
2. 或使用项目级 `.claude/settings.local.json`
3. 或手动在全局 settings.json 中添加允许规则

---

## 卸载指南

如需移除 feishu-cli，按以下步骤操作：

```bash
# 1. 删除项目目录
rm -rf ~/projects/feishu-cli

# 2. 删除全局 Skill
rm -rf ~/.claude/skills/feishu-doc

# 3. （可选）从 settings.json 中移除权限预设
# 手动编辑 ~/.claude/settings.json，删除 feishu-cli 相关的 allow 规则
```

---

## 附录：飞书应用配置完整清单

如果用户尚未配置飞书应用，提供以下完整步骤：

### A. 创建应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击"创建自建应用"
3. 填写应用名称和描述
4. 创建成功后，记录 App ID 和 App Secret

### B. 启用网页应用能力

1. 左侧菜单 → **应用能力** → **网页应用** → 开启
2. 桌面端/移动端主页：填写 `http://localhost:7777`（仅占位用）

### C. 配置 OAuth 重定向 URL

1. 左侧菜单 → **安全设置** → **重定向 URL**
2. 添加：`http://localhost:7777/callback`
3. 保存

### D. 添加权限范围

左侧菜单 → **权限管理** → 搜索并开通以下权限：

| 权限 | 说明 |
|------|------|
| `docx:document` | 读写文档 |
| `docs:doc` | 读写旧版文档 |
| `drive:drive` | 读写云空间文件 |
| `wiki:wiki` | 读写知识库 |
| `bitable:bitable` | 读写多维表格 |
| `offline_access` | 获取 refresh_token（必需） |

### E. 发布应用版本

**重要：** 权限修改后需要创建版本并发布才能生效。

1. 左侧菜单 → **版本管理与发布**
2. 创建版本
3. 申请发布
4. 等待审核通过（企业内部应用通常秒过）

---

## Claude Code 执行摘要

当用户说"帮我下载 GitHub 项目并完成自动部署"时，Claude Code 应：

1. ✅ 检查环境（Node.js 18+）
2. ✅ 询问飞书应用凭证（App ID 和 App Secret）
3. ✅ 克隆项目到 `~/projects/feishu-cli`
4. ✅ 运行 `npm install`
5. ✅ 创建 `config.json` 并填入凭证
6. ✅ 读取 README.md 中的 Skill 内容
7. ✅ 将 Skill 写入 `~/.claude/skills/feishu-doc/SKILL.md`
8. ✅ 可选：配置权限预设
9. ✅ 运行 `npm run auth` 并等待用户完成授权
10. ✅ 验证 `user-token.txt` 生成
11. ✅ 输出部署报告

**全过程自动化，无需用户手动操作文件。**
