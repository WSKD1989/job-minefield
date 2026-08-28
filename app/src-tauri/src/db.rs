// SQLite 数据访问层：建表与各类增删改查

use rusqlite::{params, Connection, OptionalExtension, Result};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::{
    Application, ApplicationInput, ChatInput, ChatMsg, Company, CompanyDetail, CompanyInput,
    ImportSummary, Position, PositionInput, Stats, TagStat,
};

// 统一数据库连接状态，供 Tauri 命令共享
pub struct Db(pub Mutex<Connection>);

/// 打开数据库并初始化表结构（不存在则创建）
pub fn open(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    ensure_schema(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// 老库补列迁移：本地工具升级时为新字段增列，避免重建表丢数据
fn migrate(conn: &Connection) -> Result<()> {
    let cols = |table: &str| -> Vec<String> {
        if let Ok(mut s) = conn.prepare(&format!("PRAGMA table_info({table})")) {
            if let Ok(rows) = s.query_map([], |r| r.get::<_, String>(1)) {
                return rows.filter_map(|r| r.ok()).collect();
            }
        }
        Vec::new()
    };
    let pcols = cols("positions");
    let ccols = cols("chats");
    let compcols = cols("companies");

    if !compcols.iter().any(|c| c == "biz_info") {
        conn.execute("ALTER TABLE companies ADD COLUMN biz_info TEXT", [])?;
    }
    if !pcols.iter().any(|c| c == "hr_contact") {
        conn.execute("ALTER TABLE positions ADD COLUMN hr_contact TEXT", [])?;
    }
    if !ccols.iter().any(|c| c == "position_id") {
        conn.execute("ALTER TABLE chats ADD COLUMN position_id INTEGER", [])?;
    }
    if !ccols.iter().any(|c| c == "contact") {
        conn.execute("ALTER TABLE chats ADD COLUMN contact TEXT", [])?;
    }
    if !compcols.iter().any(|c| c == "no_contact") {
        conn.execute("ALTER TABLE companies ADD COLUMN no_contact INTEGER NOT NULL DEFAULT 0", [])?;
    }
    Ok(())
}

/// 建表（幂等）
fn ensure_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS companies (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            industry    TEXT,
            website     TEXT,
            address     TEXT,
            contact     TEXT,
            description TEXT,
            risk_level  TEXT,
            risk_note   TEXT,
            ai_score    INTEGER,
            ai_summary  TEXT,
            ai_detail   TEXT,
            biz_info    TEXT,
            no_contact  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS positions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id  INTEGER NOT NULL,
            title       TEXT NOT NULL,
            salary_min  TEXT,
            salary_max  TEXT,
            salary_note TEXT,
            location    TEXT,
            work_type   TEXT,
            hr_contact  TEXT,
            note        TEXT,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id  INTEGER NOT NULL,
            position_id INTEGER,
            platform    TEXT,
            contact     TEXT,
            role        TEXT NOT NULL,
            content     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id  INTEGER NOT NULL,
            tag         TEXT NOT NULL,
            UNIQUE(company_id, tag)
        );
        CREATE TABLE IF NOT EXISTS applications (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id  INTEGER NOT NULL,
            applied_at  INTEGER NOT NULL,
            channel     TEXT,
            note        TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        "#,
    )
}

fn now() -> i64 {
    chrono::Local::now().timestamp()
}

fn row_to_company(r: &rusqlite::Row) -> rusqlite::Result<Company> {
    Ok(Company {
        id: r.get(0)?,
        name: r.get(1)?,
        industry: r.get(2)?,
        website: r.get(3)?,
        address: r.get(4)?,
        contact: r.get(5)?,
        description: r.get(6)?,
        risk_level: r.get(7)?,
        risk_note: r.get(8)?,
        ai_score: r.get(9)?,
        ai_summary: r.get(10)?,
        ai_detail: r.get(11)?,
        biz_info: r.get(12)?,
        no_contact: r.get::<_, i64>(13)? != 0,
        tags: r.get::<_, Option<String>>(16)?.map(|s| s.split("||").map(String::from).collect()).unwrap_or_default(),
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
    })
}

fn row_to_position(r: &rusqlite::Row) -> rusqlite::Result<Position> {
    Ok(Position {
        id: r.get(0)?,
        company_id: r.get(1)?,
        title: r.get(2)?,
        salary_min: r.get(3)?,
        salary_max: r.get(4)?,
        salary_note: r.get(5)?,
        location: r.get(6)?,
        work_type: r.get(7)?,
        hr_contact: r.get(8)?,
        note: r.get(9)?,
        created_at: r.get(10)?,
    })
}

fn row_to_chat(r: &rusqlite::Row) -> rusqlite::Result<ChatMsg> {
    Ok(ChatMsg {
        id: r.get(0)?,
        company_id: r.get(1)?,
        position_id: r.get(2)?,
        platform: r.get(3)?,
        contact: r.get(4)?,
        role: r.get(5)?,
        content: r.get(6)?,
        created_at: r.get(7)?,
    })
}

fn row_to_application(r: &rusqlite::Row) -> rusqlite::Result<Application> {
    Ok(Application {
        id: r.get(0)?,
        company_id: r.get(1)?,
        applied_at: r.get(2)?,
        channel: r.get(3)?,
        note: r.get(4)?,
    })
}

// ---------- 公司 ----------

/// 列出公司，可按关键词模糊搜索、按标签过滤；默认按 AI 评分降序（未评分排最后），
/// 同分按最近更新排序。前端会基于该列表再做本地排序/分组。
pub fn list_companies(conn: &Connection, kw: &str, tag: &str) -> Result<Vec<Company>> {
    let sql = r#"
        SELECT c.id, c.name, c.industry, c.website, c.address, c.contact, c.description,
               c.risk_level, c.risk_note, c.ai_score, c.ai_summary, c.ai_detail,
               c.biz_info, c.no_contact, c.created_at, c.updated_at,
               (SELECT GROUP_CONCAT(t.tag, '||') FROM tags t WHERE t.company_id = c.id) AS tags_str
        FROM companies c
        WHERE ($1 = '' OR c.name LIKE '%'||$1||'%' OR c.industry LIKE '%'||$1||'%'
               OR c.description LIKE '%'||$1||'%')
          AND ($2 = '' OR EXISTS (SELECT 1 FROM tags t WHERE t.company_id=c.id AND t.tag=$2))
        ORDER BY COALESCE(c.ai_score, -1) DESC, c.updated_at DESC
        "#;
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![kw.trim(), tag.trim()], |r| row_to_company(r))?;
    rows.collect()
}

/// 查询单个公司详情及关联信息
pub fn get_company(conn: &Connection, id: i64) -> Result<Option<CompanyDetail>> {
    let company = conn
        .query_row(
            "SELECT id, name, industry, website, address, contact, description,
                    risk_level, risk_note, ai_score, ai_summary, ai_detail,
                    biz_info, no_contact, created_at, updated_at,
                    (SELECT GROUP_CONCAT(t.tag, '||') FROM tags t WHERE t.company_id = companies.id) AS tags_str
             FROM companies WHERE id=?1",
            params![id],
            |r| row_to_company(r),
        )
        .optional()?;
    let Some(company) = company else { return Ok(None) };

    let positions = {
        let mut s = conn.prepare(
            "SELECT id, company_id, title, salary_min, salary_max, salary_note, location,
                    work_type, hr_contact, note, created_at
             FROM positions WHERE company_id=?1 ORDER BY id",
        )?;
        let rows = s.query_map(params![id], row_to_position)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let chats = {
        let mut s = conn.prepare(
            "SELECT id, company_id, position_id, platform, contact, role, content, created_at
             FROM chats WHERE company_id=?1 ORDER BY created_at",
        )?;
        let rows = s.query_map(params![id], row_to_chat)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let applications = {
        let mut s = conn.prepare(
            "SELECT id, company_id, applied_at, channel, note
             FROM applications WHERE company_id=?1 ORDER BY applied_at",
        )?;
        let rows = s.query_map(params![id], row_to_application)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let tags: Vec<String> = {
        let mut stmt = conn.prepare("SELECT tag FROM tags WHERE company_id=?1 ORDER BY id")?;
        let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let apply_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM applications WHERE company_id=?1",
        params![id],
        |r| r.get(0),
    )?;

    Ok(Some(CompanyDetail {
        company,
        positions,
        tags,
        applications,
        chats,
        apply_count,
    }))
}

pub fn insert_company(conn: &Connection, input: &CompanyInput) -> Result<i64> {
    let ts = now();
    conn.execute(
        "INSERT INTO companies (name, industry, website, address, contact, description, risk_level, risk_note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            input.name,
            input.industry,
            input.website,
            input.address,
            input.contact,
            input.description,
            input.risk_level,
            input.risk_note,
            ts
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// 更新公司：None 字段保持不变，Some 空串视为清空为 NULL
pub fn update_company(conn: &Connection, id: i64, input: &CompanyInput) -> Result<()> {
    let ts = now();
    conn.execute(
        "UPDATE companies SET name=?1, industry=?2, website=?3, address=?4, contact=?5,
                description=?6, risk_level=?7, risk_note=?8,
                no_contact=COALESCE(?9, no_contact), updated_at=?10 WHERE id=?11",
        params![
            input.name,
            or_null(&input.industry),
            or_null(&input.website),
            or_null(&input.address),
            or_null(&input.contact),
            or_null(&input.description),
            or_null(&input.risk_level),
            or_null(&input.risk_note),
            input.no_contact.map(|b| if b { 1 } else { 0 }),
            ts,
            id
        ],
    )?;
    Ok(())
}

pub fn delete_company(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM companies WHERE id=?1", params![id])?;
    conn.execute("DELETE FROM positions WHERE company_id=?1", params![id])?;
    conn.execute("DELETE FROM chats WHERE company_id=?1", params![id])?;
    conn.execute("DELETE FROM tags WHERE company_id=?1", params![id])?;
    conn.execute("DELETE FROM applications WHERE company_id=?1", params![id])?;
    Ok(())
}

/// 保存 AI 评分结果
pub fn save_score(conn: &Connection, company_id: i64, score: i64, summary: &str, risk_level: &str, detail: &str) -> Result<()> {
    conn.execute(
        "UPDATE companies SET ai_score=?1, ai_summary=?2, ai_detail=?3, risk_level=?4, updated_at=?5 WHERE id=?6",
        params![score, summary, detail, risk_level, now(), company_id],
    )?;
    Ok(())
}

/// 保存工商信息快照（爱企查）
pub fn set_biz_info(conn: &Connection, company_id: i64, biz_info: &str) -> Result<()> {
    conn.execute(
        "UPDATE companies SET biz_info=?1, updated_at=?2 WHERE id=?3",
        params![or_null(&Some(biz_info.to_string())), now(), company_id],
    )?;
    Ok(())
}

// ---------- 标签 ----------

pub fn list_tag_stats(conn: &Connection) -> Result<Vec<TagStat>> {
    let mut stmt = conn.prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY COUNT(*) DESC")?;
    let rows = stmt.query_map([], |r| {
        Ok(TagStat {
            tag: r.get(0)?,
            count: r.get(1)?,
        })
    })?;
    rows.collect()
}

pub fn add_tag(conn: &Connection, company_id: i64, tag: &str) -> Result<()> {
    let tag = tag.trim();
    if tag.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO tags (company_id, tag) VALUES (?1, ?2)",
        params![company_id, tag],
    )?;
    Ok(())
}

pub fn remove_tag(conn: &Connection, company_id: i64, tag: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM tags WHERE company_id=?1 AND tag=?2",
        params![company_id, tag],
    )?;
    Ok(())
}

// ---------- 岗位 ----------

pub fn add_position(conn: &Connection, input: &PositionInput) -> Result<i64> {
    conn.execute(
        "INSERT INTO positions (company_id, title, salary_min, salary_max, salary_note, location, work_type, hr_contact, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.company_id,
            input.title,
            input.salary_min,
            input.salary_max,
            input.salary_note,
            input.location,
            input.work_type,
            input.hr_contact,
            input.note,
            now()
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_position(conn: &Connection, id: i64, input: &PositionInput) -> Result<()> {
    conn.execute(
        "UPDATE positions SET title=?1, salary_min=?2, salary_max=?3, salary_note=?4,
                location=?5, work_type=?6, hr_contact=?7, note=?8 WHERE id=?9",
        params![
            input.title,
            or_null(&input.salary_min),
            or_null(&input.salary_max),
            or_null(&input.salary_note),
            or_null(&input.location),
            or_null(&input.work_type),
            or_null(&input.hr_contact),
            or_null(&input.note),
            id
        ],
    )?;
    Ok(())
}

pub fn delete_position(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM positions WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- 对话 ----------

pub fn add_chat(conn: &Connection, input: &ChatInput) -> Result<i64> {
    conn.execute(
        "INSERT INTO chats (company_id, position_id, platform, contact, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.company_id,
            input.position_id,
            input.platform,
            input.contact,
            input.role,
            input.content,
            now()
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_chat(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM chats WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- 投递记录 ----------

pub fn add_application(conn: &Connection, input: &ApplicationInput) -> Result<i64> {
    let applied_at = input.applied_at.unwrap_or_else(now);
    conn.execute(
        "INSERT INTO applications (company_id, applied_at, channel, note) VALUES (?1, ?2, ?3, ?4)",
        params![input.company_id, applied_at, input.channel, input.note],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_application(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM applications WHERE id=?1", params![id])?;
    Ok(())
}

// ---------- 设置 ----------

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
}

pub fn save_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---------- 统计 / 导出 ----------

/// 首页统计概览
pub fn get_stats(conn: &Connection) -> Result<Stats> {
    let company_count: i64 = conn.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get(0))?;
    let apply_count: i64 = conn.query_row("SELECT COUNT(*) FROM applications", [], |r| r.get(0))?;
    let scored_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM companies WHERE ai_score IS NOT NULL", [], |r| r.get(0))?;
    let avg_score: Option<f64> = conn
        .query_row("SELECT AVG(ai_score) FROM companies", [], |r| r.get(0))?;
    Ok(Stats {
        company_count,
        apply_count,
        scored_count,
        avg_score: avg_score.map(|v| (v * 10.0).round() / 10.0),
    })
}

/// 导出全部数据为 JSON（用于备份/迁移）
pub fn export_data(conn: &Connection) -> Result<serde_json::Value> {
    let companies = list_companies(conn, "", "")?;
    let mut arr = Vec::with_capacity(companies.len());
    for c in companies {
        if let Some(d) = get_company(conn, c.id)? {
            arr.push(serde_json::json!({
                "company": d.company,
                "positions": d.positions,
                "tags": d.tags,
                "applications": d.applications,
                "chats": d.chats,
            }));
        }
    }
    Ok(serde_json::json!({
        "app": "应聘避坑小工具",
        "version": 1,
        "exported_at": now(),
        "companies": arr,
    }))
}

// ---------- 备份导入 ----------

/// 取 JSON 值的可选字符串（缺字段 / null / 非字符串 → None）
fn opt_str(v: Option<&serde_json::Value>) -> Option<String> {
    v.and_then(|v| v.as_str()).map(String::from)
}

/// 从导出的 JSON 备份导入全部数据（事务内执行，任一步失败整体回滚）
/// 策略：同名公司跳过（不入库），避免覆盖已有记录；对话关联岗位按旧 id 映射到新岗位 id。
pub fn import_data(conn: &Connection, json: &str) -> Result<ImportSummary> {
    let root: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let list = root
        .get("companies")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();

    conn.execute_batch("BEGIN")?;
    let mut sum = ImportSummary::default();
    let run = (|| -> Result<()> {
        for item in &list {
            let company = item.get("company").ok_or_else(|| {
                rusqlite::Error::ToSqlConversionFailure(
                    "备份数据缺少 company 字段".into(),
                )
            })?;
            let name = opt_str(company.get("name")).unwrap_or_default();
            if name.trim().is_empty() {
                sum.skipped += 1;
                continue;
            }
            // 同名跳过：避免重复收录
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM companies WHERE name=?1",
                params![name],
                |r| r.get(0),
            )?;
            if exists > 0 {
                sum.skipped += 1;
                continue;
            }
            let ts = now();
            // 完整写入公司记录（保留评分、工商信息、时间戳等）
            let comp_vals = (
                name,
                opt_str(company.get("industry")),
                opt_str(company.get("website")),
                opt_str(company.get("address")),
                opt_str(company.get("contact")),
                opt_str(company.get("description")),
                opt_str(company.get("risk_level")),
                opt_str(company.get("risk_note")),
                company.get("ai_score").and_then(|v| v.as_i64()),
                opt_str(company.get("ai_summary")),
                opt_str(company.get("ai_detail")),
                opt_str(company.get("biz_info")),
                (company.get("no_contact").and_then(|v| v.as_bool()).unwrap_or(false) as i64),
                company.get("created_at").and_then(|v| v.as_i64()).unwrap_or(ts),
                company.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(ts),
            );
            conn.execute(
                "INSERT INTO companies (name, industry, website, address, contact, description,
                        risk_level, risk_note, ai_score, ai_summary, ai_detail, biz_info,
                        no_contact, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    comp_vals.0, comp_vals.1, comp_vals.2, comp_vals.3, comp_vals.4,
                    comp_vals.5, comp_vals.6, comp_vals.7, comp_vals.8, comp_vals.9,
                    comp_vals.10, comp_vals.11, comp_vals.12, comp_vals.13, comp_vals.14,
                ],
            )?;
            let cid = conn.last_insert_rowid();
            sum.companies += 1;

            // 标签
            if let Some(arr) = item.get("tags").and_then(|t| t.as_array()) {
                for t in arr {
                    if let Some(tag) = t.as_str() {
                        conn.execute(
                            "INSERT INTO tags (company_id, tag) VALUES (?1,?2)",
                            params![cid, tag],
                        )?;
                        sum.tags += 1;
                    }
                }
            }

            // 岗位：记录旧 id -> 新 id 映射，供对话关联
            let mut pos_map: HashMap<i64, i64> = HashMap::new();
            if let Some(arr) = item.get("positions").and_then(|p| p.as_array()) {
                for p in arr {
                    let title = opt_str(p.get("title")).unwrap_or_default();
                    if title.trim().is_empty() {
                        continue;
                    }
                    let pos_vals = (
                        cid,
                        title,
                        opt_str(p.get("salary_min")),
                        opt_str(p.get("salary_max")),
                        opt_str(p.get("salary_note")),
                        opt_str(p.get("location")),
                        opt_str(p.get("work_type")),
                        opt_str(p.get("hr_contact")),
                        opt_str(p.get("note")),
                        p.get("created_at").and_then(|v| v.as_i64()).unwrap_or(ts),
                    );
                    conn.execute(
                        "INSERT INTO positions (company_id, title, salary_min, salary_max,
                                salary_note, location, work_type, hr_contact, note, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                        params![
                            pos_vals.0, pos_vals.1, pos_vals.2, pos_vals.3, pos_vals.4,
                            pos_vals.5, pos_vals.6, pos_vals.7, pos_vals.8, pos_vals.9,
                        ],
                    )?;
                    if let Some(old) = p.get("id").and_then(|v| v.as_i64()) {
                        pos_map.insert(old, conn.last_insert_rowid());
                    }
                    sum.positions += 1;
                }
            }

            // 投递记录
            if let Some(arr) = item.get("applications").and_then(|a| a.as_array()) {
                for a in arr {
                    let app_vals = (
                        cid,
                        a.get("applied_at").and_then(|v| v.as_i64()).unwrap_or(ts),
                        opt_str(a.get("channel")),
                        opt_str(a.get("note")),
                    );
                    conn.execute(
                        "INSERT INTO applications (company_id, applied_at, channel, note)
                         VALUES (?1,?2,?3,?4)",
                        params![app_vals.0, app_vals.1, app_vals.2, app_vals.3],
                    )?;
                    sum.applications += 1;
                }
            }

            // 对话
            if let Some(arr) = item.get("chats").and_then(|c| c.as_array()) {
                for c in arr {
                    let content = opt_str(c.get("content")).unwrap_or_default();
                    if content.trim().is_empty() {
                        continue;
                    }
                    let old_pid = c.get("position_id").and_then(|v| v.as_i64());
                    let pid = old_pid.and_then(|p| pos_map.get(&p).copied());
                    let role = opt_str(c.get("role")).unwrap_or_else(|| "对方".into());
                    let chat_vals = (
                        cid,
                        pid,
                        opt_str(c.get("platform")),
                        opt_str(c.get("contact")),
                        role,
                        content,
                        c.get("created_at").and_then(|v| v.as_i64()).unwrap_or(ts),
                    );
                    conn.execute(
                        "INSERT INTO chats (company_id, position_id, platform, contact, role,
                                content, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![
                            chat_vals.0, chat_vals.1, chat_vals.2, chat_vals.3, chat_vals.4,
                            chat_vals.5, chat_vals.6,
                        ],
                    )?;
                    sum.chats += 1;
                }
            }
        }
        Ok(())
    })();
    match run {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(sum)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

// ---------- 工具函数 ----------

fn or_null(v: &Option<String>) -> Option<&str> {
    match v {
        Some(s) if !s.trim().is_empty() => Some(s),
        _ => None,
    }
}

// ---------- 数据层运行验证 ----------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;

    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_conn() -> Connection {
        // 并行测试下每个用例用独立文件，避免互相污染
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = format!("target/test_db_{}_{}.db", std::process::id(), n);
        let _ = std::fs::remove_file(&path);
        open(&path).unwrap()
    }

    #[test]
    fn crud_flow_works() {
        let conn = test_conn();
        // 建公司 + 标签 + 岗位 + 投递 + 对话 + 评分
        let id = insert_company(
            &conn,
            &CompanyInput {
                name: "某外包科技".into(),
                industry: Some("外包".into()),
                description: Some("驻场开发".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_tag(&conn, id, "甲方").unwrap();
        add_tag(&conn, id, "外派岗位").unwrap();
        add_position(
            &conn,
            &PositionInput {
                company_id: id,
                title: "Java 开发".into(),
                salary_min: Some("15k".into()),
                salary_max: Some("20k".into()),
                hr_contact: Some("张HR".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_application(
            &conn,
            &ApplicationInput {
                company_id: id,
                channel: Some("BOSS直聘".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_chat(
            &conn,
            &ChatInput {
                company_id: id,
                position_id: Some(1),
                platform: Some("BOSS".into()),
                contact: Some("张HR".into()),
                role: "对方".into(),
                content: "您好，周末方便面试吗".into(),
            },
        )
        .unwrap();
        save_score(&conn, id, 82, "较靠谱", "低", "自研项目为主，待遇正常").unwrap();

        // 详情聚合校验
        let detail = get_company(&conn, id).unwrap().unwrap();
        assert_eq!(detail.company.name, "某外包科技");
        assert_eq!(detail.company.ai_score, Some(82));
        assert_eq!(detail.apply_count, 1);
        assert_eq!(detail.positions.len(), 1);
        assert_eq!(detail.positions[0].hr_contact.as_deref(), Some("张HR"));
        assert_eq!(detail.tags, vec!["甲方", "外派岗位"]);
        assert_eq!(detail.chats.len(), 1);
        assert_eq!(detail.chats[0].contact.as_deref(), Some("张HR"));
        assert_eq!(detail.chats[0].position_id, Some(1));

        // 模糊搜索 + 标签过滤
        assert_eq!(list_companies(&conn, "外包", "").unwrap().len(), 1);
        assert_eq!(list_companies(&conn, "", "外派岗位").unwrap().len(), 1);
        assert_eq!(list_companies(&conn, "不存在的关键词", "").unwrap().len(), 0);

        // 移除标签并复核
        remove_tag(&conn, id, "甲方").unwrap();
        assert_eq!(get_company(&conn, id).unwrap().unwrap().tags, vec!["外派岗位"]);

        // 级联删除
        delete_company(&conn, id).unwrap();
        assert!(get_company(&conn, id).unwrap().is_none());
    }

    #[test]
    fn migrate_adds_new_columns() {
        // 手工构造一份旧结构库，验证 open 会自动补列
        let path = format!("target/test_migrate_{}.db", std::process::id());
        let _ = std::fs::remove_file(&path);
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, industry TEXT, website TEXT, address TEXT, contact TEXT, description TEXT, risk_level TEXT, risk_note TEXT, ai_score INTEGER, ai_summary TEXT, ai_detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
                 CREATE TABLE positions (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, title TEXT NOT NULL, salary_min TEXT, salary_max TEXT, salary_note TEXT, location TEXT, work_type TEXT, note TEXT, created_at INTEGER NOT NULL);
                 CREATE TABLE chats (id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, platform TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);",
            )
            .unwrap();
        }
        let c = open(&path).unwrap();
        let cols = |t: &str| {
            let mut s = c.prepare(&format!("PRAGMA table_info({t})")).unwrap();
            s.query_map([], |r| r.get::<_, String>(1))
                .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
        };
        assert!(cols("companies").contains(&"biz_info".to_string()));
        assert!(cols("positions").contains(&"hr_contact".to_string()));
        assert!(cols("chats").contains(&"position_id".to_string()));
        assert!(cols("chats").contains(&"contact".to_string()));

        // 关键回归：老库 ALTER 追加列(列在末尾) 后，显式列名读取必须正确映射
        let id = insert_company(
            &c,
            &CompanyInput {
                name: "老库企业".into(),
                industry: Some("金融".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_position(
            &c,
            &PositionInput {
                company_id: id,
                title: "测试岗".into(),
                hr_contact: Some("李HR".into()),
                ..Default::default()
            },
        )
        .unwrap();
        add_chat(
            &c,
            &ChatInput {
                company_id: id,
                position_id: Some(1),
                platform: None,
                contact: Some("李HR".into()),
                role: "对方".into(),
                content: "您好".into(),
            },
        )
        .unwrap();
        let d = get_company(&c, id).unwrap().unwrap();
        assert_eq!(d.company.name, "老库企业");
        assert_eq!(d.positions[0].hr_contact.as_deref(), Some("李HR"));
        assert_eq!(d.chats[0].contact.as_deref(), Some("李HR"));
        let list = list_companies(&c, "", "").unwrap();
        assert_eq!(list[0].name, "老库企业");
        drop(c);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn stats_handles_null_avg() {
        let conn = test_conn();
        // 空库：AVG 返回 NULL，不能报错
        let s0 = get_stats(&conn).unwrap();
        assert_eq!(s0.company_count, 0);
        assert_eq!(s0.avg_score, None);

        // 有公司但都未评分：AVG 仍为 NULL
        let id = insert_company(
            &conn,
            &CompanyInput {
                name: "未评分企业".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let s1 = get_stats(&conn).unwrap();
        assert_eq!(s1.company_count, 1);
        assert_eq!(s1.scored_count, 0);
        assert_eq!(s1.avg_score, None);

        // 评分后 avg 正常
        save_score(&conn, id, 90, "良好", "低", "说明").unwrap();
        let s2 = get_stats(&conn).unwrap();
        assert_eq!(s2.scored_count, 1);
        assert_eq!(s2.avg_score, Some(90.0));
    }

    #[test]
    fn import_restores_backup() {
        let conn = test_conn();
        // 造一份与 export_data 同构的备份 JSON
        let json = r#"{
            "app": "应聘避坑小工具",
            "version": 1,
            "exported_at": 1750000000,
            "companies": [{
                "company": {
                    "id": 1, "name": "备份公司A", "industry": "互联网", "website": null,
                    "address": "北京", "contact": "HR-陈", "description": "自研SaaS",
                    "risk_level": "低", "risk_note": null, "ai_score": 88,
                    "ai_summary": "评分88分", "ai_detail": null, "biz_info": "注册资本100万",
                    "no_contact": false, "tags": [], "created_at": 1700000000, "updated_at": 1750000000
                },
                "positions": [{
                    "id": 10, "company_id": 1, "title": "前端开发", "salary_min": "15k",
                    "salary_max": "22k", "salary_note": null, "location": "北京",
                    "work_type": "onsite", "hr_contact": "HR-陈", "note": null, "created_at": 1710000000
                }],
                "tags": ["甲方", "自研"],
                "applications": [{ "id": 5, "company_id": 1, "applied_at": 1720000000, "channel": "BOSS直聘", "note": null }],
                "chats": [{ "id": 9, "company_id": 1, "position_id": 10, "platform": "BOSS", "contact": "HR-陈", "role": "对方", "content": "方便周末面试吗", "created_at": 1730000000 }]
            }, {
                "company": {
                    "id": 2, "name": "备份公司B", "industry": null, "website": null,
                    "address": null, "contact": null, "description": null,
                    "risk_level": null, "risk_note": null, "ai_score": null,
                    "ai_summary": null, "ai_detail": null, "biz_info": null,
                    "no_contact": true, "tags": [], "created_at": 1700000000, "updated_at": 1750000000
                },
                "positions": [], "tags": ["避雷"], "applications": [], "chats": []
            }]
        }"#;

        // 导入后逐项核验（公司/岗位/对话/投递/标签，时间戳保留，对话岗位关联重映射）
        let sum = import_data(&conn, json).unwrap();
        assert_eq!(sum.companies, 2);
        assert_eq!(sum.positions, 1);
        assert_eq!(sum.chats, 1);
        assert_eq!(sum.applications, 1);
        assert_eq!(sum.tags, 3); // 甲方/自研 + 避雷
        assert_eq!(sum.skipped, 0);

        let d1 = get_company(&conn, 1).unwrap().unwrap();
        assert_eq!(d1.company.name, "备份公司A");
        assert_eq!(d1.company.ai_score, Some(88)); // 评分保留
        assert_eq!(d1.company.biz_info.as_deref(), Some("注册资本100万"));
        assert_eq!(d1.company.created_at, 1700000000);
        assert_eq!(d1.tags, vec!["甲方", "自研"]);
        assert_eq!(d1.positions.len(), 1);
        assert_eq!(d1.positions[0].title, "前端开发");
        assert_eq!(d1.positions[0].hr_contact.as_deref(), Some("HR-陈"));
        assert_eq!(d1.applications.len(), 1);
        assert_eq!(d1.applications[0].channel.as_deref(), Some("BOSS直聘"));
        assert_eq!(d1.chats.len(), 1);
        assert_eq!(d1.chats[0].content, "方便周末面试吗");
        // 对话岗位关联重新映射到新岗位 id（不再是旧的 10）
        assert_eq!(d1.chats[0].position_id, Some(d1.positions[0].id));

        // 再次导入：同名跳过
        let sum2 = import_data(&conn, json).unwrap();
        assert_eq!(sum2.skipped, 2);
        assert_eq!(sum2.companies, 0);
        // 库内仍只有 2 家，没有重复
        assert_eq!(list_companies(&conn, "", "").unwrap().len(), 2);
    }

    #[test]
    fn import_invalid_json_rolls_back() {
        let conn = test_conn();
        let id = insert_company(
            &conn,
            &CompanyInput {
                name: "既有企业".into(),
                ..Default::default()
            },
        )
        .unwrap();
        // 第一个公司合法、第二个缺 company 字段 → 整体回滚
        let bad = r#"{"companies": [
            {"company": {"name": "合法公司", "industry": null, "created_at": 1, "updated_at": 1},
             "positions": [], "tags": [], "applications": [], "chats": []},
            {"positions": []}
        ]}"#;
        assert!(import_data(&conn, bad).is_err());
        // 回滚后合法公司也未写入
        assert!(get_company(&conn, id).unwrap().is_some());
        assert_eq!(list_companies(&conn, "", "").unwrap().len(), 1);
    }
}