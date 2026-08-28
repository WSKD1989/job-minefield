// 数据库实体及命令参数的数据结构定义

use serde::{Deserialize, Serialize};

/// 公司（应聘单位）主记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Company {
    pub id: i64,
    pub name: String,
    pub industry: Option<String>,
    pub website: Option<String>,
    pub address: Option<String>,
    pub contact: Option<String>,
    pub description: Option<String>,
    pub risk_level: Option<String>,
    pub risk_note: Option<String>,
    pub ai_score: Option<i64>,
    pub ai_summary: Option<String>,
    pub ai_detail: Option<String>,
    pub biz_info: Option<String>, // 爱企查等工商信息快照
    pub no_contact: bool, // 不再沟通标记
    pub tags: Vec<String>, // 公司标签（列表查询附带，详情页 tags 独立字段）
    pub created_at: i64,
    pub updated_at: i64,
}

/// 创建/更新公司入参（带 `pub ` 注释的可选字段，由前端决定传哪些）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CompanyInput {
    pub name: String,
    pub industry: Option<String>,
    pub website: Option<String>,
    pub address: Option<String>,
    pub contact: Option<String>,
    pub description: Option<String>,
    pub risk_level: Option<String>,
    pub risk_note: Option<String>,
    pub no_contact: Option<bool>, // 不再沟通标记（None 保持不变）
}

/// 岗位（应聘职位）记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: i64,
    pub company_id: i64,
    pub title: String,
    pub salary_min: Option<String>,
    pub salary_max: Option<String>,
    pub salary_note: Option<String>,
    pub location: Option<String>,
    pub work_type: Option<String>, // onsite / remote / hybrid
    pub hr_contact: Option<String>, // 对接 HR / 联系人
    pub note: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PositionInput {
    pub company_id: i64,
    pub title: String,
    pub salary_min: Option<String>,
    pub salary_max: Option<String>,
    pub salary_note: Option<String>,
    pub location: Option<String>,
    pub work_type: Option<String>,
    pub hr_contact: Option<String>,
    pub note: Option<String>,
}

/// 线上沟通对话记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    pub id: i64,
    pub company_id: i64,
    pub position_id: Option<i64>, // 关联岗位（可空）
    pub platform: Option<String>,
    pub contact: Option<String>, // 对话对象（如 HR 姓名 / 猎头）
    pub role: String, // 我方 / 对方
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatInput {
    pub company_id: i64,
    pub position_id: Option<i64>,
    pub platform: Option<String>,
    pub contact: Option<String>,
    pub role: String,
    pub content: String,
}

/// 投递记录（统计投递次数与时间）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Application {
    pub id: i64,
    pub company_id: i64,
    pub applied_at: i64,
    pub channel: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApplicationInput {
    pub company_id: i64,
    pub applied_at: Option<i64>,
    pub channel: Option<String>,
    pub note: Option<String>,
}

/// 公司详情（公司信息 + 关联的岗位/标签/投递/对话）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanyDetail {
    pub company: Company,
    pub positions: Vec<Position>,
    pub tags: Vec<String>,
    pub applications: Vec<Application>,
    pub chats: Vec<ChatMsg>,
    pub apply_count: i64,
}

/// 标签统计（用于筛选栏展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagStat {
    pub tag: String,
    pub count: i64,
}

/// AI 评分结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreResult {
    pub company_id: i64,
    pub score: i64,
    pub summary: String,
    pub risk_level: String,
    pub detail: String,
}

/// 首页统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub company_count: i64,
    pub apply_count: i64,
    pub scored_count: i64,
    pub avg_score: Option<f64>,
}

/// 备份导入结果统计（前端展示导入了多少、跳过了多少同名）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportSummary {
    pub companies: i64,
    pub positions: i64,
    pub chats: i64,
    pub applications: i64,
    pub tags: i64,
    pub skipped: i64, // 同名被跳过的公司数
}