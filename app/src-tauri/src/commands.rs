// Tauri 命令层：把数据库与 AI 能力暴露给前端调用

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ai;
use crate::db;
use crate::db::Db;
use crate::models::{
    ApplicationInput, ChatInput, Company, CompanyDetail, CompanyInput, ImportSummary, PositionInput,
    ScoreResult, Stats, TagStat,
};

/// 对外暴露的设置项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsOut {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

// ---------- 公司 ----------

#[tauri::command]
pub fn list_companies(state: State<'_, Db>, keyword: String, tag: String) -> Result<Vec<Company>, String> {
    let conn = state.0.lock().unwrap();
    db::list_companies(&conn, &keyword, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_company_detail(state: State<'_, Db>, id: i64) -> Result<Option<CompanyDetail>, String> {
    let conn = state.0.lock().unwrap();
    db::get_company(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_company(state: State<'_, Db>, input: CompanyInput) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    db::insert_company(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_company(state: State<'_, Db>, id: i64, input: CompanyInput) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::update_company(&conn, id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_company(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::delete_company(&conn, id).map_err(|e| e.to_string())
}

// ---------- 标签 ----------

#[tauri::command]
pub fn list_tags(state: State<'_, Db>) -> Result<Vec<TagStat>, String> {
    let conn = state.0.lock().unwrap();
    db::list_tag_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_company_tag(state: State<'_, Db>, company_id: i64, tag: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::add_tag(&conn, company_id, &tag).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_company_tag(state: State<'_, Db>, company_id: i64, tag: String) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::remove_tag(&conn, company_id, &tag).map_err(|e| e.to_string())
}

// ---------- 岗位 ----------

#[tauri::command]
pub fn add_position(state: State<'_, Db>, input: PositionInput) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    db::add_position(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_position(state: State<'_, Db>, id: i64, input: PositionInput) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::update_position(&conn, id, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_position(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::delete_position(&conn, id).map_err(|e| e.to_string())
}

// ---------- 对话 ----------

#[tauri::command]
pub fn add_chat(state: State<'_, Db>, input: ChatInput) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    db::add_chat(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_chat(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::delete_chat(&conn, id).map_err(|e| e.to_string())
}

// ---------- 投递记录 ----------

#[tauri::command]
pub fn add_application(
    state: State<'_, Db>,
    input: ApplicationInput,
) -> Result<i64, String> {
    let conn = state.0.lock().unwrap();
    db::add_application(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_application(state: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::delete_application(&conn, id).map_err(|e| e.to_string())
}

// ---------- 设置 ----------

#[tauri::command]
pub fn get_settings(state: State<'_, Db>) -> Result<SettingsOut, String> {
    let conn = state.0.lock().unwrap();
    let read = |k: &str| db::get_setting(&conn, k).ok().flatten().unwrap_or_default();
    Ok(SettingsOut {
        api_key: read("api_key"),
        base_url: read("base_url"),
        model: read("model"),
    })
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, Db>,
    api_key: String,
    base_url: String,
    model: String,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    db::save_setting(&conn, "api_key", &api_key).map_err(|e| e.to_string())?;
    db::save_setting(&conn, "base_url", &base_url).map_err(|e| e.to_string())?;
    db::save_setting(&conn, "model", &model).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 统计 / 导出 ----------

#[tauri::command]
pub fn get_stats(state: State<'_, Db>) -> Result<Stats, String> {
    let conn = state.0.lock().unwrap();
    db::get_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data(state: State<'_, Db>) -> Result<String, String> {
    let conn = state.0.lock().unwrap();
    let v = db::export_data(&conn).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&v).map_err(|e| e.to_string())
}

/// 从 JSON 备份导入数据（同名公司跳过），返回导入统计
#[tauri::command]
pub fn import_data(state: State<'_, Db>, json: String) -> Result<ImportSummary, String> {
    let conn = state.0.lock().unwrap();
    db::import_data(&conn, &json).map_err(|e| e.to_string())
}

// ---------- 岗位 URL 读取 / AI 解析录入 ----------

/// 抓取招聘链接网页并转为文本
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    ai::fetch_url_text(&url).await
}

/// 无头浏览器渲染抓取 URL 转为文本（对需 JS 渲染/反爬的站点更有效）
#[tauri::command]
pub async fn render_url_text(url: String) -> Result<String, String> {
    ai::render_url_text(&url).await
}

/// 用 DeepSeek 从招聘文本解析岗位字段
#[tauri::command]
pub async fn ai_parse_job(state: State<'_, Db>, text: String) -> Result<serde_json::Value, String> {
    let (api_key, base_url, model) = {
        let conn = state.0.lock().unwrap();
        let read = |k: &str| db::get_setting(&conn, k).ok().flatten().unwrap_or_default();
        (read("api_key"), read("base_url"), read("model"))
    };
    if api_key.is_empty() {
        return Err("尚未配置 DeepSeek API Key，请先在「设置」中填写后重试".into());
    }
    ai::parse_job(&text, &api_key, &base_url, &model).await
}

// ---------- 爱企查工商信息 ----------

/// 搜索并抓取爱企查，返回原始文本供 AI 抽取
#[tauri::command]
pub async fn fetch_aiqicha(query: String) -> Result<String, String> {
    ai::fetch_aiqicha(&query).await
}

/// 站点感知抓取：按域名（爱企查/企查查/天眼查）配置专用 UA/Referer
#[tauri::command]
pub async fn fetch_biz_url(url: String) -> Result<String, String> {
    ai::fetch_biz_url(&url).await
}

/// 从文本解析企业工商信息并写回（返回快照文本）
#[tauri::command]
pub async fn query_biz(
    state: State<'_, Db>,
    company_id: i64,
    text: String,
) -> Result<String, String> {
    let (api_key, base_url, model) = {
        let conn = state.0.lock().unwrap();
        let read = |k: &str| db::get_setting(&conn, k).ok().flatten().unwrap_or_default();
        (read("api_key"), read("base_url"), read("model"))
    };
    if api_key.is_empty() {
        return Err("尚未配置 DeepSeek API Key，请先在「设置」中填写后重试".into());
    }
    let parsed = ai::parse_company(&text, &api_key, &base_url, &model).await?;
    let snapshot = ai::biz_info_text(&parsed);
    let conn = state.0.lock().unwrap();
    db::set_biz_info(&conn, company_id, &snapshot).map_err(|e| e.to_string())?;
    Ok(snapshot)
}

// ---------- AI 评分（异步）----------

#[tauri::command]
pub async fn score_company(state: State<'_, Db>, id: i64) -> Result<ScoreResult, String> {
    let (api_key, base_url, model) = {
        let conn = state.0.lock().unwrap();
        let read = |k: &str| db::get_setting(&conn, k).ok().flatten().unwrap_or_default();
        (read("api_key"), read("base_url"), read("model"))
    };
    if api_key.is_empty() {
        return Err("尚未配置 DeepSeek API Key，请先在「设置」中填写后重试".into());
    }
    let detail = {
        let conn = state.0.lock().unwrap();
        db::get_company(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "公司不存在".to_string())?
    };

    let result = ai::request_score(&detail, &api_key, &base_url, &model).await?;

    {
        let conn = state.0.lock().unwrap();
        db::save_score(
            &conn,
            id,
            result.score,
            &result.summary,
            &result.risk_level,
            &result.detail,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}