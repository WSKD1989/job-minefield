// 应聘避坑小工具 · 数据库层
// 与 Tauri 应用（app/src-tauri/src/db.rs）保持完全一致的建表与迁移逻辑，
// 保证 MCP 插件与桌面应用读写同一个 SQLite 文件时 schema 兼容。
import { DatabaseSync } from 'node:sqlite'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** 默认数据库路径：与 Tauri app_data_dir（com.kd89.app）保持一致 */
export function defaultDbPath() {
  if (process.env.BIKENG_DB_PATH) return process.env.BIKENG_DB_PATH
  const base =
    platform() === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.kd89.app')
      : join(homedir(), '.config', 'com.kd89.app')
  return join(base, 'bikeng.db')
}

/** 打开（必要时创建）数据库并保证 schema 就绪 */
export function openDatabase(dbPath = defaultDbPath()) {
  const db = new DatabaseSync(dbPath)
  // 桌面应用与 MCP 可能同时读写，加忙等待避免瞬时锁冲突
  db.exec('PRAGMA busy_timeout = 5000')
  ensureSchema(db)
  migrate(db)
  return db
}

/** 建表（幂等，与 db.rs::ensure_schema 一致） */
function ensureSchema(db) {
  db.exec(`
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
  `)
}

/** 老库补列迁移（与 db.rs::migrate 一致） */
function migrate(db) {
  const cols = (table) => {
    try {
      return db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name)
    } catch {
      return []
    }
  }
  const pcols = cols('positions')
  const ccols = cols('chats')
  const compcols = cols('companies')
  if (!compcols.includes('biz_info')) db.exec('ALTER TABLE companies ADD COLUMN biz_info TEXT')
  if (!pcols.includes('hr_contact')) db.exec('ALTER TABLE positions ADD COLUMN hr_contact TEXT')
  if (!ccols.includes('position_id')) db.exec('ALTER TABLE chats ADD COLUMN position_id INTEGER')
  if (!ccols.includes('contact')) db.exec('ALTER TABLE chats ADD COLUMN contact TEXT')
  if (!compcols.includes('no_contact')) db.exec('ALTER TABLE companies ADD COLUMN no_contact INTEGER NOT NULL DEFAULT 0')
}

export const now = () => Math.floor(Date.now() / 1000)