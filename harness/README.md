# 应聘避坑小工具 · CLI 与「BOSS链式记录」技能包

让 DeepSeek Harness（DSH）等 AI 助手直接读写「应聘避坑小工具」的数据库（SQLite）：
查询、录入、更新公司/岗位/投递/对话，并用 DeepSeek 做风险评分；配合配套工具，
可在 BOSS直聘 上实现**一键采集 → 一条命令导入**的「BOSS链式记录」极低耗流程。

> 桌面应用源码见仓库根目录 `app/`；本目录是它的 **AI/CLI 配套层**。

## 组成

| 文件 | 说明 |
|---|---|
| `cli.mjs` | 零依赖 CLI 主程序（Node ≥ 22.5，内置 node:sqlite） |
| `lib/db.mjs` | 数据库层：与桌面应用一致的建表/迁移逻辑 |
| `skills/yingpin-bikeng/SKILL.md.tpl` | DSH 技能模板（安装时写入 CLI/工具绝对路径） |
| `install.ps1` | 一键安装：装技能到 `.dsh/skills`、生成 `yingpin.cmd`、自检 |
| `test.mjs` | 进程内集成测试（`node test.mjs`，37 项断言） |
| `tools/boss-capture.user.js` | **配套工具①**：BOSS直聘用户脚本，一键采集会话/职位/公司为 JSON |
| `tools/import-capture.mjs` | **配套工具②**：采集 JSON → 数据库 一键导入 |
| `tools/sample-capture.json` | 采集 JSON 样例（格式参考） |

## 快速开始

```powershell

powershell -ExecutionPolicy Bypass -File .\install.ps1

```

脚本会：
1. 把技能安装到 `%USERPROFILE%\.dsh\skills\yingpin-bikeng\SKILL.md`（所有工作区可见，并写入 CLI 与 tools 的绝对路径）；
2. 生成 `.dsh/bin/yingpin.cmd` 包装器（可选加入 PATH）；
3. 运行 `node cli.mjs doctor` 自检。

然后**完全退出并重启 DSH Desktop**，新会话即可自动加载技能；之后直接对 AI 说
「记录这家公司」「帮我查一下 XX 有没有记录」「评估这个岗位风险」即可。

不装技能也能用——AI 或脚本可直接调用：

```powershell
node cli.mjs list --json
node cli.mjs add-company 某某科技 --industry 互联网 --risk-level 中
```

## CLI 子命令一览

| 子命令 | 用途 |
|---|---|
| `list [关键字] [--tag 标签]` | 列出公司，支持关键词/标签过滤 |
| `get <ID>` | 公司详情（岗位、标签、投递、对话） |
| `add-company <名称> [--industry] [--website] [--address] [--contact] [--description] [--risk-level] [--risk-note]` | 新增公司 |
| `update-company <ID> [--name] [--industry] [--website] [--address] [--contact] [--description] [--risk-level] [--risk-note] [--no-contact true|false]` | 更新公司 |
| `delete-company <ID> --yes` | 删除公司及关联数据（需确认） |
| `tag <公司ID> <标签>` | 打标签（甲方/外包/避雷等） |
| `add-position <公司ID> <岗位名> [--salary-min] [--salary-max] [--salary-note] [--location] [--work-type] [--hr] [--note]` | 新增岗位 |
| `update-position <ID> [--title] [--salary-min] [--salary-max] [--salary-note] [--location] [--work-type] [--hr] [--note]` | 更新岗位 |
| `apply <公司ID> [--channel] [--at] [--note]` | 记录投递 |
| `chat <公司ID> --role 我方|对方 --content 内容 [--contact] [--position-id] [--platform] [--at]` | 录入对话（`--content -` 从 stdin 读） |
| `score <ID>` | DeepSeek 综合评分并写回（需应用内配置 API Key） |
| `db` / `doctor` | 显示数据库路径 / 环境自检 |

### 对 AI/脚本友好的设计

- **`--json`**：任意子命令加 `--json` 输出纯 JSON（stdout），错误一律走 stderr；
- **`--compact`**：list/get 极简输出，巡检时省 token；
- **退出码**：`0` 成功 / `1` 业务或数据库错误 / `2` 参数错误；
- **stdin 通道**：`chat --content -` 从标准输入读长文本；
- **幂等**：`tag` 重复自动忽略；`update-*` 只改传入字段；
- **安全**：`delete-company` 必须显式 `--yes`；
- **自检**：`doctor` 报告 Node 版本、数据表、API Key 配置状态。

## BOSS链式记录（配套工具工作流）

目标：把「BOSS 上一家公司 → 数据库一条记录」的成本压到**每轮 2 次工具调用**。

### ① 采集（用户脚本）

1. 安装 Tampermonkey / Violentmonkey，新建脚本，粘贴 `tools/boss-capture.user.js` 内容保存；
2. 打开 BOSS直聘聊天页，页面右下角出现「📋 采集会话」按钮；
3. 点击按钮 → 弹出面板显示解析结果（可编辑：一行一条 `[对方]内容`，可改角色/增删）→
   点「复制 JSON」（或「下载 JSON」）；
4. 把 JSON 粘贴给 AI，或把文件路径告诉 AI。

聊天页采集消息与 HR 名；职位详情页补充岗位/JD；公司页补充公司简介。JSON 结构见 `tools/sample-capture.json`。

### ② 导入（import-capture）

```powershell
node tools/import-capture.mjs capture.json --tags 已读不回,避雷 --no-contact
# 或从 stdin：
type capture.json | node tools/import-capture.mjs - --db 路径
# 只预览不写库：
node tools/import-capture.mjs capture.json --dry-run
```

一条命令完成：公司按名查重（存在则补空字段）/ 新建 → 岗位新增（JD 写入备注，薪资自动拆分为上下限）→
对话逐条写入（自动关联岗位）→ 打标签 / 标记不再沟通。输出：

- 人类可读：`公司 #12 某某科技（新建） | 岗位 #3 Java开发 | 对话 5 条 | 标签: 已读不回`
- `--json`：`{"id":12,"name":"...","company_created":true,"position":{"id":3,"title":"..."},"chats":5,"tags":["已读不回"],"no_contact":false}`

### 无脚本时的 Agent 采集方式

AI 在 run_code 内注入捕获器、由用户点击「查看职位」完成采集（详见技能文档）；录入阶段用
`node tools/import-capture.mjs` 仍可一步完成。

## 数据

- 默认数据库：`%APPDATA%\com.kd89.app\bikeng.db`（与 Tauri 桌面应用共用）；
- 覆盖：环境变量 `BIKENG_DB_PATH` 或 `--db <路径>`；
- 桌面应用与 CLI 任一侧的修改，另一侧立即可见。

## 测试

```powershell
node test.mjs        # 37 项进程内集成测试（临时库，不影响真实数据）
```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

## 常见问题

- **score 报「尚未配置 DeepSeek API Key」**：在桌面应用 Settings 中填写 API Key（base_url/model 也可配置）；
- **重启后技能没生效**：确认 `.dsh/skills/yingpin-bikeng/SKILL.md` 存在；DSH 技能发现根目录为 `.dsh/skills`（用户级）与 `<工作区>/.dsh/skills`（项目级）；
- **用户脚本按钮没出现**：确认在 `https://www.zhipin.com/web/geek/chat*` 页面、脚本管理器已启用；刷新页面或等待 1–2 秒；
- **采集解析不准**：BOSS 页面结构会变，脚本按多种选择器 + 对齐启发式解析；面板内可直接编辑修正后再导出；
- **中文乱码**：`yingpin.cmd` 已含 `chcp 65001`；直接 `node cli.mjs` 时若终端为 GBK 属正常显示问题，输出本身是 UTF-8；
- **数据库被占用**：桌面应用正在运行时 SQLite 可能短暂锁库，已内置 busy_timeout=5s，重试即可。
