# Job-Minefield · 求职路上的避坑雷达

> 收录求职中接触的每一家公司，用 AI 评分 + 人工标注双重把关，让风险公司提前现形。

应聘避坑小工具（**Job-Minefield**）是一款基于 Tauri + Vue 3 的本地桌面应用，
帮助你系统管理求职过程中的公司档案：AI 综合评分、人工风险等级、岗位薪资、
投递进度、沟通记录、离线 OCR 识别，一站式沉淀你的求职避坑数据。

## ✨ 核心功能

### ⚡ 双保险风控
- **AI 综合评分**——调用 DeepSeek 大模型，基于公司规模、融资、口碑、劳动风险等信息给出 0–100 分与摘要、详细分析；分数自动分档配色（≥80 推荐 / 60–79 谨慎 / 40–59 偏高 / <40 避雷）。
- **人工风险标注**——低 / 中 / 高 / 极高四级风险等级 + 风险备注，记录「狼性文化」「996」「社保最低基数」等面试信号，全局联动配色。

### 📥 快速建档
- **离线 OCR 识别**——基于 Tesseract.js（WASM）本地识别中英文，面试截图、招聘弹窗一键提取文字并填入搜索。
- **链接抓取**——粘贴企业详情页链接，AI 解析工商信息（爱企查）。
- **同名查重**——重复收录前自动提醒，避免档案冗余。

### ⚙ 检索与组织
- 关键词搜索（300ms 防抖即时响应）· 标签多选过滤 · 沟通状态过滤
- 四种排序（更新 / 评分 / 风险 / 名称）+ 按风险 / 状态分组
- 卡片 / 列表双视图，偏好自动记忆

### 🗂 全流程追踪
- **岗位管理**——多岗位记录，薪资范围、工作形式（驻场 / 远程 / 混合）、HR 联系方式
- **投递记录**——投递时间、渠道、备注
- **沟通时间线**——逐轮对话留痕，标注平台与角色

### 🔒 数据安全
- 数据全程本地存储（SQLite），无需注册、无需上传
- **备份 / 恢复**——JSON 一键导出，导入前预览、事务写入、同名自动跳过
- **表单防丢失**——未保存离开自动提醒

## 🧰 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · TypeScript · Pinia · Vue Router · Lucide Icons |
| 桌面壳 | Tauri 2（Rust） |
| 数据库 | SQLite（通过 Tauri 命令访问） |
| AI | DeepSeek API（Key 仅存本机） |
| OCR | Tesseract.js（WASM，本地识别） |

## 🚀 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) 18+ 与 [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) 稳定版（Tauri 要求）
- Windows / macOS / Linux（Tauri 支持平台）

### 开发运行

```bash
cd app
pnpm install
pnpm tauri dev
```

### 打包

```bash
pnpm tauri build
```

构建产物位于 `app/src-tauri/target/release/bundle/`。

## 📁 项目结构

```
.
├── app/                    # 应用主目录
│   ├── src/                # 前端（Vue 3）
│   │   ├── views/          # 首页 / 详情 / 表单 / 设置
│   │   ├── components/     # ConfirmModal / Toast 组件
│   │   ├── stores/         # Pinia 状态
│   │   ├── api.ts          # Tauri 命令调用
│   │   └── ocr.ts          # 离线 OCR 封装
│   └── src-tauri/          # Rust 后端
│       └── src/            # db.rs / ai.rs / commands.rs
└── landing.html            # 项目介绍推广页
```

## 📄 开源协议

本仓库默认不附带协议，请在正式发布前补充 LICENSE 文件。