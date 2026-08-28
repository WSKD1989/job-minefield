#!/usr/bin/env node
// 应聘避坑小工具 · 配套工具：BOSS链式记录「采集 JSON → 数据库」一键导入
// 与 desktop 应用 / cli.mjs 读写同一个 SQLite 库（schema 由 lib/db.mjs 保证一致）。
//
// 用法:
//   node tools/import-capture.mjs <capture.json>          # 导入采集文件
//   node tools/import-capture.mjs -                       # 从 stdin 读 JSON
//   node tools/import-capture.mjs x.json --db 路径         # 指定数据库
//   node tools/import-capture.mjs x.json --tags 已读不回,避雷
//   node tools/import-capture.mjs x.json --no-contact     # 标记为不再沟通
//   node tools/import-capture.mjs x.json --dry-run        # 只预览不写库
//   node tools/import-capture.mjs x.json --human          # 人类可读输出（默认即 human；--json 输出纯 JSON）
//
// 采集 JSON 结构（由 tools/boss-capture.user.js 生成，也可手工构造）:
// {
//   "platform": "BOSS直聘",
//   "source_url": "https://www.zhipin.com/...",
//   "captured_at": 1787900000,
//   "hr": "陈女士(HR)",
//   "job":    { "title": "Java开发", "salary": "20-35K", "salary_note": "13薪",
//               "location": "广州·天河", "experience": "3-5年", "education": "本科",
//               "jd": "岗位职责…", "keywords": "Java,Spring" },
//   "company": { "name": "广州某某科技", "industry": "互联网", "funding": "A轮",
//                "headcount": "100-499人", "address": "广州…", "intro": "…", "hot_jobs": ["…"] },
//   "messages": [ { "role": "对方", "contact": "陈女士(HR)", "content": "您好…", "at": 1787900000 } ]
// }
import { readFileSync } from 'node:fs'
import { openDatabase, defaultDbPath, now } from '../lib/db.mjs'

// ---------- 参数 ----------
function parseArgs(argv) {
  const flags = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-') { positional.push('-'); continue }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq >= 0) { flags.set(a.slice(2, eq), a.slice(eq + 1)); continue }
      const next = argv[i + 1]
      if (next !== undefined && next !== '--' && !next.startsWith('--')) { flags.set(a.slice(2), next); i++ }
      else flags.set(a.slice(2), true)
    } else positional.push(a)
  }
  return { flags, positional }
}

const { flags, positional } = parseArgs(process.argv.slice(2))
const file = positional[0]
if (!file) {
  console.error('用法: node tools/import-capture.mjs <capture.json|-> [--db 路径] [--tags 标签,标签] [--no-contact] [--dry-run] [--human|--json]')
  process.exit(2)
}
const json = flags.get('json') === true
const human = flags.get('human') === true || !json

class UsageError extends Error { constructor(m) { super(m); this.code = 2 } }
class BizError extends Error { constructor(m) { super(m); this.code = 1 } }

// ---------- 读取输入 ----------
let raw
try {
  raw = file === '-' ? requireStdin() : readFileSync(file, 'utf8')
} catch (e) {
  console.error('读取失败: ' + (e?.message ?? e))
  process.exit(2)
}
function requireStdin() {
  // 同步读 stdin（fd 0），避免引入额外依赖
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

let data
try {
  data = JSON.parse(raw)
} catch (e) {
  console.error('JSON 解析失败: ' + (e?.message ?? e))
  process.exit(2)
}

// ---------- 归一化 ----------
const s = (v) => (typeof v === 'string' ? v.trim() : '')
const normRole = (r) => {
  const v = s(r)
  if (v === '我方' || v === '我') return '我方'
  if (v === '对方' || v === '他' || v === 'TA' || v === 'ta') return '对方'
  throw new UsageError('消息角色非法: ' + JSON.stringify(r) + '（应为 我方|对方）')
}
// "20-35K" → {min:"20K",max:"35K"}; "面议" → null
function parseSalary(sal) {
  const v = s(sal).replace(/[，,]/g, '-')
  if (!v || /面议|薪资面议/i.test(v)) return { min: null, max: null }
  const m = v.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*([Kk万Ww]?)/)
  if (m) {
    const unit = m[3] || 'K'
    return { min: m[1] + unit, max: m[2] + unit }
  }
  return { min: v, max: null }
}

// ---------- 主流程 ----------
let db
try {
  const dbPath = typeof flags.get('db') === 'string' ? flags.get('db') : defaultDbPath()
  db = openDatabase(dbPath)
  const dryRun = flags.get('dry-run') === true

  const companyName = s(data.company?.name)
  if (!companyName) throw new UsageError('缺少 company.name，无法定位公司')

  const hr = s(data.hr || data.company?.contact)
  const platform = s(data.platform || '')
  const company = data.company || {}
  const job = data.job || {}
  const messages = Array.isArray(data.messages) ? data.messages : []

  // 1) 公司：按名称查重，不存在则新建；已存在仅补空字段
  let companyId = db.prepare('SELECT id FROM companies WHERE name = ?').get(companyName)?.id ?? null
  let companyCreated = false
  const desc = [
    s(company.funding) && '融资:' + company.funding,
    s(company.headcount) && '规模:' + company.headcount,
    s(company.intro),
  ].filter(Boolean).join('；') || null

  if (dryRun) {
    companyId = companyId ?? 0
  } else if (companyId === null) {
    const info = db.prepare(
      'INSERT INTO companies(name,industry,address,contact,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
    ).run(companyName, s(company.industry) || null, s(company.address) || null, hr || null, desc, now(), now())
    companyId = Number(info.lastInsertRowid)
    companyCreated = true
  } else {
    // 已存在：补空字段（不覆盖已有内容）
    db.prepare(
      "UPDATE companies SET industry=COALESCE(NULLIF(industry,''),?), address=COALESCE(NULLIF(address,''),?), contact=COALESCE(NULLIF(contact,''),?), description=COALESCE(NULLIF(description,''),?), updated_at=? WHERE id=?"
    ).run(s(company.industry) || null, s(company.address) || null, hr || null, desc || null, now(), companyId)
  }

  // 2) 岗位：按标题查重，新增岗位并回填 JD
  const salary = parseSalary(job.salary)
  let positionId = null
  let positionCreated = false
  if (s(job.title)) {
    const existing = db.prepare('SELECT id FROM positions WHERE company_id=? AND title=? ORDER BY id LIMIT 1').get(companyId, s(job.title))
    if (existing) {
      positionId = existing.id
    } else if (!dryRun) {
      const note = [s(job.jd) && ('【JD】' + s(job.jd)), s(job.experience) && ('经验:' + s(job.experience)), s(job.education) && ('学历:' + s(job.education)), s(job.keywords) && ('关键词:' + s(job.keywords))].filter(Boolean).join('\n') || null
      const info = db.prepare(
        'INSERT INTO positions(company_id,title,salary_min,salary_max,salary_note,location,work_type,hr_contact,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
      ).run(companyId, s(job.title), salary.min, salary.max, s(job.salary_note) || null, s(job.location) || null, null, hr || null, note, now())
      positionId = Number(info.lastInsertRowid)
      positionCreated = true
    } else positionId = -1
  }

  // 3) 对话：逐条写入，关联岗位（单岗位时自动关联）
  const chatIds = []
  let at = typeof data.captured_at === 'number' ? data.captured_at : now()
  for (const m of messages) {
    const role = normRole(m.role)
    const content = s(m.content)
    if (!content) continue
    const ts = typeof m.at === 'number' ? m.at : at
    if (!dryRun) {
      const info = db.prepare(
        'INSERT INTO chats(company_id,position_id,platform,contact,role,content,created_at) VALUES(?,?,?,?,?,?,?)'
      ).run(companyId, positionId ?? null, platform || null, s(m.contact) || hr || null, role, content.slice(0, 2000), ts)
      chatIds.push(Number(info.lastInsertRowid))
    } else chatIds.push(-1)
    at = ts + 1
  }

  // 4) 标签 / 状态
  const tags = []
  const tagFlag = flags.get('tags')
  if (typeof tagFlag === 'string') {
    for (const t of tagFlag.split(/[,，]/)) {
      const v = s(t)
      if (!v) continue
      tags.push(v)
      if (!dryRun) db.prepare('INSERT OR IGNORE INTO tags(company_id,tag) VALUES(?,?)').run(companyId, v)
    }
  }
  let noContact = false
  const nc = flags.get('no-contact')
  if (nc === true || nc === 'true' || nc === '1' || nc === 'yes') {
    noContact = true
    if (!dryRun) db.prepare('UPDATE companies SET no_contact=1, updated_at=? WHERE id=?').run(now(), companyId)
  }

  // 5) 输出
  const result = {
    id: companyId,
    name: companyName,
    company_created: companyCreated,
    position: positionCreated ? { id: positionId, title: s(job.title) } : null,
    chats: chatIds.length,
    tags,
    no_contact: noContact,
  }
  if (json) {
    console.log(JSON.stringify(result))
  } else {
    const parts = [
      `公司 #${companyId} ${companyName}${companyCreated ? '（新建）' : '（已存在，补空字段）'}`,
      positionCreated ? `岗位 #${positionId} ${s(job.title)}` : (positionId ? `岗位已存在（#${positionId}）` : '未新增岗位'),
      `对话 ${chatIds.length} 条`,
      tags.length ? `标签: ${tags.join(', ')}` : '',
      noContact ? '状态: 不再沟通' : '',
      dryRun ? '（dry-run，未写库）' : '',
    ].filter(Boolean)
    console.log(parts.join(' | '))
  }
  process.exit(0)
} catch (e) {
  console.error(e instanceof UsageError ? '参数错误: ' + e.message : (e instanceof BizError ? e.message : '错误: ' + (e?.message ?? e)))
  process.exit(e instanceof UsageError ? 2 : 1)
} finally {
  try { db?.close() } catch {}
}
