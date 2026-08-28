---
name: yingpin-bikeng
description: 操作「应聘避坑小工具」求职避坑数据库。当用户提到应聘、求职、面试、避坑、避雷、招聘骗局、外包/外派/甲方判断、公司风险、记录投递或 HR 沟通时使用，通过本技能提供的 CLI 查询、录入与评估公司。
---

# 应聘避坑小工具（CLI）

本地求职避坑数据库工具（Tauri 桌面应用 + CLI 插件）。DSH 通过命令行直接读写其 SQLite 数据库，与桌面应用共用同一数据，无需打开应用。

## 命令

调用方式（以下 `yingpin` 均指完整命令）：

    node {{CLI_PATH}} <子命令> [参数] [--json] [--db <sqlite路径>]

若已执行安装脚本且把 $DSH_HOME\bin 加入 PATH，也可直接使用 `yingpin`。

### 查询

| 命令 | 说明 |
|---|---|
| yingpin list [关键字] [--tag 标签] | 列出公司，支持关键词模糊搜索与标签过滤 |
| yingpin get <公司ID> | 公司详情：岗位、标签、投递数、近期对话 |
| yingpin db | 显示当前数据库路径 |
| yingpin doctor [--json] | 环境自检：Node 版本、数据表、API Key 是否配置 |

### 录入与更新

| 命令 | 说明 |
|---|---|
| yingpin add-company <名称> [--industry 行业] [--website 网址] [--address 地址] [--contact 联系人] [--description 简介] [--risk-level 低\|中\|高\|极高] [--risk-note 备注] | 新增公司 |
| yingpin update-company <ID> [--name ..] [--risk-level ..] [--risk-note ..] ... | 更新公司；传空字符串可清空字段 |
| yingpin delete-company <ID> --yes | 删除公司及全部关联数据（必须 --yes） |
| yingpin tag <公司ID> <标签> | 打标签（甲方/乙方/外派/外包/自研/避雷…），重复自动忽略 |
| yingpin add-position <公司ID> <岗位名> [--salary-min ..] [--salary-max ..] [--salary-note ..] [--location 地点] [--work-type onsite\|remote\|hybrid] [--hr 对接HR] [--note 备注] | 新增岗位 |
| yingpin update-position <ID> [--title ..] [--salary-min ..] [--salary-max ..] [--salary-note ..] [--location ..] [--work-type ..] [--hr ..] [--note ..] | 更新岗位 |
| yingpin apply <公司ID> [--channel 渠道如BOSS直聘] [--at unix秒] [--note 备注] | 记录一次投递 |
| yingpin chat <公司ID> --role 我方\|对方 --content 内容 [--contact 对话对象] [--position-id ID] [--platform 平台] | 录入一条沟通对话；长内容或含引号时用 --content - 从标准输入读取 |

### 评估

| 命令 | 说明 |
|---|---|
| yingpin score <公司ID> | 调用 DeepSeek 综合评分并写回（需桌面应用 Settings 已配置 API Key，未配置会报错并退出码 1）；评分 0-100，**越高越安全**，风险等级 低/中/高/极高 与之对应 |

## 数据模型

- 公司 companies：名称/行业/网站/地址/联系人/简介/风险等级（低中高极高）/风险备注/AI 评分与结论
- 岗位 positions：公司下职位，含薪资范围、地点、工作方式（onsite/remote/hybrid）、对接 HR
- 标签 tags：公司级标签（甲方/外包/避雷等）
- 投递 applications：投递时间/渠道/备注
- 对话 chats：与 HR 的沟通记录，role 为「我方」或「对方」，可关联岗位并标注联系人

## 工作流

### 录入一家新公司
1. add-company 创建公司（尽量填全行业/网站/地址/简介）。
2. add-position 添加岗位与对接 HR。
3. tag 打标签（甲方/外包/避雷 等）。
4. 有投递用 apply；有沟通用 chat 逐条录入（保持原文，标注角色与 HR；长内容走 stdin）。
5. 数据足够后可用 score 让 AI 给出风险评分与结论。

### 查询与评估
- 用户问「这家公司怎么样/有没有记录」→ list 搜关键词，再 get 看详情；没有记录时主动录入并追问细节。
- 用户分享一段 HR 对话 → 找到公司后 chat 录入，然后综合标签、对话与岗位信息给出避坑建议，必要时建议 score。
- 命令失败时先跑 yingpin doctor --json 排查（数据库位置、表结构、API Key）。

## 约定

- 对话 role 只能是「我方」或「对方」，content 保持原文不转述。
- 风险等级取值：低 / 中 / 高 / 极高。
- 时间戳为 unix 秒；apply 的 --at 缺省为当前时间。
- 所有写操作默认输出人类可读；脚本/Agent 解析一律加 --json（输出纯 JSON 到 stdout，错误在 stderr，退出码 0/1/2）。
- 删除公司是危险操作，必须显式 --yes。

## 配套工具（可选，强烈推荐）

仓库 `harness/tools/` 提供两个配套工具，可把「BOSS链式记录」从依赖 Agent 注入采集，升级为**用户一键采集 + 一条命令导入**：

| 工具 | 作用 |
|---|---|
| `tools/boss-capture.user.js` | BOSS直聘用户脚本（Tampermonkey/Violentmonkey）：聊天页/职位页/公司页一键采集为 JSON（复制或下载） |
| `tools/import-capture.mjs` | 采集 JSON → 数据库 一键导入：`node {{TOOLS_DIR}}/import-capture.mjs capture.json [--tags ..] [--no-contact]`，支持 stdin（`-`）与 `--db` |

## BOSS链式记录（触发词：「BOSS链式记录」）——二段式极低耗流程

当用户说「BOSS链式记录」时，按 **采集 → 一次性录入** 两段执行，**每轮仅 2 次工具调用**。

> ⚠️ 协作规则：页面点击由用户真人操作；有 href 入口直接读链接；全程精提取；**建议在新会话中执行以降低历史上下文成本**。

### 阶段一：采集（1 次工具调用）
**方式 A（推荐，已安装用户脚本）**：让用户打开 BOSS直聘聊天页，点击页面右下角「📋 采集会话」按钮 → 点「复制 JSON」并把 JSON 粘贴给 AI（或「下载 JSON」后由 AI 读取文件）。聊天/职位/公司页均可采集，输出即 import-capture 的输入格式。
**方式 B（无脚本时，1 次 run_code）**：单个 run_code 内注入捕获器→等用户点击「查看职位」（轮询≤8×3s）→精提取三页→**return 压缩 JSON ≤1500 字符**：
- 聊天页：会话名/HR + 职位名+薪资 + 消息（每条 ≤120 字符，最多 6 条）；
- 职位页：只保留「标题薪资|经验学历|关键词|JD前700字|公司卡片名」；
- 公司页：只保留「融资规模行业|在招数BOSS数|热招职位前4条|公司简介前300字」。
每页用关键字截断（去掉 看过该职位/精选职位/推荐公司/热门职位/页脚）。

### 阶段二：一次性录入（1 次工具调用）
**方式 A（推荐，有 import-capture 工具）**：把采集 JSON 保存为临时文件后运行
`node {{TOOLS_DIR}}/import-capture.mjs capture.json [--tags 已读不回,避雷] [--no-contact]`
（或从 stdin 读：`cat capture.json | node {{TOOLS_DIR}}/import-capture.mjs -`）。一条命令完成：公司按名查重/新建 → 岗位新增（JD 写 note）→ 对话逐条写入（自动关联岗位）→ 标签/状态。
**方式 B（无工具时，1 次 pwsh 运行临时 node 脚本）**：把采集 JSON 内嵌进一个临时 `.mjs`（用 `lib/db.mjs` 的 openDatabase），一次完成：
`add-company`(或按名查重) → `chat`×N(带 --at) → `tag`(已读不回/不再沟通等) → `add-position`(JD 写 note) → `update-company`(description/risk_note/industry/address) → 对话关联 position_id。
脚本最后 `console.log(JSON.stringify({id, positions, chats, tags}))`（≤100 字符），跑完删除。

### 判定
- 对话仅我方且已读 → tag 已读不回；对方婉拒/结束 → no_contact=1（`--no-contact`）；
- 风险信号（大小周/底薪提成/新公司/注册资本低/外包驻场/法人即招聘者等）→ risk_note（import-capture 后补 `yingpin update-company`，或直接在 JSON 的 company.intro 中保留线索）。

### 费用原则
- 每轮 **2 次工具调用**（采集 + 录入），总输入 ≤2500 字符；
- 采集中间结果不进 LLM 上下文；
- **新会话执行**（历史短）是最大降费手段——单轮费用可再降 50%+。

## 数据位置

- 默认数据库：Windows %APPDATA%\com.kd89.app\bikeng.db；可通过环境变量 BIKENG_DB_PATH 或 --db 覆盖。
- 桌面应用与 CLI 读写同一个库，任一侧的修改另一方立即可见。