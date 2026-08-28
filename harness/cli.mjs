#!/usr/bin/env node
// 应聘避坑小工具 · DeepSeek Harness CLI 插件
// 零依赖命令行工具：让 DSH（及其他 AI/脚本）直接查询、录入、评估本工具的 SQLite 数据。
// 用法: node cli.mjs <子命令> [参数]   （--help 查看完整帮助）
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openDatabase, defaultDbPath, now } from './lib/db.mjs'

const VERSION = '0.4.0'

// ---------- 参数解析 ----------
/**
 * 解析 argv 为 { flags: Map<string,string|boolean>, positional: string[] }
 * 支持: --key value / --key=value / --key(布尔) / "-" 作为字面值（从 stdin 读）
 */
function parseArgs(argv) {
  const flags = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { positional.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq >= 0) {
        flags.set(a.slice(2, eq), a.slice(eq + 1))
      } else {
        const key = a.slice(2)
        const next = argv[i + 1]
        if (next !== undefined && next !== '--' && !next.startsWith('--')) {
          flags.set(key, next); i++
        } else {
          flags.set(key, true)
        }
      }
    } else if (a === '-') {
      positional.push('-')
    } else {
      positional.push(a)
    }
  }
  return { flags, positional }
}

// ---------- IO 与输出 ----------
const realIo = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: () => new Promise((res, rej) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => { data += c })
    process.stdin.on('end', () => res(data))
    process.stdin.on('error', rej)
  }),
}

function out(io, s) { io.stdout(s + '\n') }
function err(io, s) { io.stderr(s + '\n') }

/** 统一结果输出：json 模式输出纯 JSON；否则走 human 格式化函数 */
function emit(io, json, data, human) {
  if (json) out(io, JSON.stringify(data, null, 2))
  else out(io, human(data))
}

// ---------- 帮助 ----------
const HELP = `应聘避坑小工具 CLI v${VERSION} —— 求职避坑数据库（DeepSeek Harness 插件）

用法:
  node cli.mjs <子命令> [参数] [--json] [--db <sqlite路径>]

查询:
  list [关键字] [--tag 标签]          列出公司（可按关键词/标签过滤）
  get <公司ID>                       公司详情（含岗位、标签、投递、对话）
  db                                显示当前数据库路径
  doctor                             环境自检（Node/数据库/API Key）

录入:
  add-company <名称> [--industry 行业] [--website 网址] [--address 地址] [--contact 联系人]
                 [--description 简介] [--risk-level 低|中|高|极高] [--risk-note 备注]
  update-company <ID> [--name 名称] [--industry ..] [--website ..] [--address ..] [--contact ..]
                    [--description ..] [--risk-level ..] [--risk-note ..] [--no-contact true|false]
  delete-company <ID> --yes          删除公司及全部关联数据（需 --yes 确认）
  tag <公司ID> <标签>                 打标签（甲方/乙方/外派/外包/自研/避雷…）
  add-position <公司ID> <岗位名> [--salary-min ..] [--salary-max ..] [--salary-note ..]
               [--location 地点] [--work-type onsite|remote|hybrid] [--hr 对接HR] [--note 备注]
  update-position <ID> [--title ..] [--salary-min ..] [--salary-max ..] [--salary-note ..]
                  [--location ..] [--work-type ..] [--hr ..] [--note ..]
  apply <公司ID> [--channel 渠道如BOSS直聘] [--at unix秒] [--note 备注]
  chat <公司ID> --role 我方|对方 --content 内容 [--contact 对话对象] [--position-id ID] [--platform 平台] [--at unix秒]
        内容可用 --content - 从标准输入读取（推荐：长对话/含引号内容）

评估:
  score <公司ID>                      调用 DeepSeek 综合评分并写回，0-100 分越高越安全（需应用内配置 API Key）

全局:
  --json      输出纯 JSON（机器可读，供脚本/Agent 解析）
  --compact   极简输出（list/get 均支持，验证/巡检用，省 token）
  --db 路径   指定数据库文件（优先级高于环境变量 BIKENG_DB_PATH，低于显式场景）
  --version   输出版本
  --help      显示本帮助

环境变量:
  BIKENG_DB_PATH  数据库路径（默认 %APPDATA%\\com.kd89.app\\bikeng.db）

退出码: 0 成功 / 1 业务或数据库错误 / 2 参数错误
`

// ---------- 数据库辅助 ----------
function rowToCompany(r) {
  return {
    id: r.id, name: r.name, industry: r.industry ?? '', website: r.website ?? '',
    address: r.address ?? '', contact: r.contact ?? '', description: r.description ?? '',
    risk_level: r.risk_level ?? '', risk_note: r.risk_note ?? '',
    ai_score: r.ai_score ?? null, ai_summary: r.ai_summary ?? '', ai_detail: r.ai_detail ?? '',
    no_contact: Boolean(r.no_contact),
    updated_at: r.updated_at,
  }
}

function companyContext(db, id) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id)
  if (!company) return null
  const positions = db.prepare('SELECT * FROM positions WHERE company_id = ? ORDER BY id').all(id)
  const tags = db.prepare('SELECT tag FROM tags WHERE company_id = ? ORDER BY id').all(id).map((r) => r.tag)
  const applyCount = db.prepare('SELECT COUNT(*) c FROM applications WHERE company_id = ?').get(id).c
  const chats = db
    .prepare('SELECT * FROM chats WHERE company_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(id)
    .reverse()
  return { company: rowToCompany(company), positions, tags, applyCount, chats }
}

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? ''
}

// ---------- 命令实现 ----------

async function cmdList(db, args, io, json) {
  const keyword = args.positional[0] ?? ''
  const tag = typeof args.flags.get('tag') === 'string' ? args.flags.get('tag') : ''
  const rows = db.prepare(
    `SELECT id,name,industry,risk_level,ai_score,updated_at,
           (SELECT GROUP_CONCAT(tag,'||') FROM tags WHERE company_id=c.id) tags
     FROM companies c
     WHERE (?1='' OR c.name LIKE ?1 OR c.industry LIKE ?1 OR c.description LIKE ?1)
       AND (?2='' OR EXISTS(SELECT 1 FROM tags t WHERE t.company_id=c.id AND t.tag=?2))
     ORDER BY COALESCE(c.ai_score,101) ASC, c.id DESC`
  ).all(`%${keyword}%`, tag).map((r) => ({ ...r, tags: r.tags ? String(r.tags).split('||') : [] }))
  const compact = args.flags.get('compact') === true
  emit(io, json, rows, (list) => {
    if (!list.length) return '(空)'
    if (compact) {
      return list.map((r) => `#${r.id} ${r.name}${r.risk_level ? ` 风险:${r.risk_level}` : ''}${r.ai_score !== null ? ` 评分:${r.ai_score}` : ''}`).join('\n')
    }
    return list.map((r) => {
      const risk = r.risk_level ? ` 风险:${r.risk_level}` : ''
      const score = r.ai_score !== null ? ` 评分:${r.ai_score}` : ''
      const tags = r.tags && r.tags.length ? ` 标签:${r.tags.join('/')}` : ''
      return `#${r.id} ${r.name}${r.industry ? ` [${r.industry}]` : ''}${risk}${score}${tags}`
    }).join('\n')
  })
}

async function cmdGet(db, args, io, json) {
  const id = Number(args.positional[0])
  if (!Number.isInteger(id)) throw new UsageError('get 需要公司 ID')
  const ctx = companyContext(db, id)
  if (!ctx) throw new BizError(`公司 #${id} 不存在`)
  if (args.flags.get('compact') === true) {
    const comp = ctx.company
    const s = []
    s.push(`#${comp.id} ${comp.name}${comp.industry ? ` [${comp.industry}]` : ''} 风险:${comp.risk_level || '—'} 评分:${comp.ai_score ?? '—'}${comp.no_contact ? ' 状态:不再沟通' : ''}`)
    s.push(`  标签:${ctx.tags.length} 岗位:${ctx.positions.length} 对话:${ctx.chats.length} 投递:${ctx.applyCount}`)
    s.push(`  岗位: ${ctx.positions.map((p) => `${p.title}(${p.salary_min ?? ''}-${p.salary_max ?? ''})`).join(' | ') || '(无)'}`)
    out(io, s.join('\n'))
    return
  }
  emit(io, json, ctx, (c) => {
    const comp = c.company
    const s = []
    s.push(`#${comp.id} ${comp.name}${comp.industry ? ` [${comp.industry}]` : ''}`)
    if (comp.website) s.push(`  网站: ${comp.website}`)
    if (comp.address) s.push(`  地址: ${comp.address}`)
    if (comp.contact) s.push(`  联系人: ${comp.contact}`)
    if (comp.description) s.push(`  简介: ${comp.description}`)
    if (comp.no_contact) s.push(`  状态: 不再沟通`)
    s.push(`  风险: ${comp.risk_level || '(未标注)'}${comp.risk_note ? ` —— ${comp.risk_note}` : ''}`)
    if (comp.ai_score !== null) s.push(`  AI评分: ${comp.ai_score} (${comp.ai_summary || ''})`)
    s.push(`  标签: ${c.tags.length ? c.tags.join(', ') : '(无)'}`)
    s.push(`  投递次数: ${c.applyCount}`)
    s.push(`  岗位:`)
    if (c.positions.length) c.positions.forEach((p) => {
      const salary = [p.salary_min, p.salary_max].filter(Boolean).join('-')
      s.push(`    #${p.id} ${p.title}${salary ? ` [${salary}` + (p.salary_note ? `,${p.salary_note}` : '') + ']' : ''}${p.hr_contact ? ` HR:${p.hr_contact}` : ''}${p.location ? ` @${p.location}` : ''}`)
    }); else s.push('    (无)')
    s.push(`  近期对话:`)
    if (c.chats.length) c.chats.forEach((m) => {
      const pos = m.position_id ? c.positions.find((p) => p.id === m.position_id)?.title : ''
      s.push(`    [${m.role}${m.contact ? `/${m.contact}` : ''}${m.platform ? `@${m.platform}` : ''}${pos ? ` →岗位:${pos}` : ''}] ${m.content}`)
    }); else s.push('    (无)')
    return s.join('\n')
  })
}

async function cmdAddCompany(db, args, io, json) {
  const name = args.positional[0]
  if (!name) throw new UsageError('add-company 需要公司名称')
  const ts = now()
  const f = (k) => typeof args.flags.get(k) === 'string' ? args.flags.get(k) : null
  const info = db.prepare(
    'INSERT INTO companies(name,industry,website,address,contact,description,risk_level,risk_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(name, f('industry'), f('website'), f('address'), f('contact'), f('description'), f('risk-level'), f('risk-note'), ts, ts)
  const id = Number(info.lastInsertRowid)
  emit(io, json, { id }, (d) => `已添加公司 #${d.id} ${name}`)
}

async function cmdUpdateCompany(db, args, io, json) {
  const id = Number(args.positional[0])
  if (!Number.isInteger(id)) throw new UsageError('update-company 需要公司 ID')
  const cur = db.prepare('SELECT * FROM companies WHERE id=?').get(id)
  if (!cur) throw new BizError(`公司 #${id} 不存在`)
  const f = (k, curVal) => {
    const v = args.flags.get(k)
    if (v === true || v === undefined) return curVal
    return v === '' ? null : v
  }
  // --no-contact true|false：不再沟通标记
  const ncFlag = args.flags.get('no-contact')
  let noContact = cur.no_contact ? 1 : 0
  if (typeof ncFlag === 'string') {
    if (ncFlag === 'true' || ncFlag === '1' || ncFlag === 'yes') noContact = 1
    else if (ncFlag === 'false' || ncFlag === '0' || ncFlag === 'no') noContact = 0
    else throw new UsageError('--no-contact 取值 true|false')
  }
  db.prepare(
    'UPDATE companies SET name=?,industry=?,website=?,address=?,contact=?,description=?,risk_level=?,risk_note=?,no_contact=?,updated_at=? WHERE id=?'
  ).run(
    f('name', cur.name), f('industry', cur.industry), f('website', cur.website),
    f('address', cur.address), f('contact', cur.contact), f('description', cur.description),
    f('risk-level', cur.risk_level), f('risk-note', cur.risk_note), noContact, now(), id
  )
  emit(io, json, { id, ok: true, no_contact: noContact === 1 }, (d) => `已更新公司 #${d.id}${d.no_contact ? '（不再沟通）' : ''}`)
}

async function cmdDeleteCompany(db, args, io, json) {
  const id = Number(args.positional[0])
  if (!Number.isInteger(id)) throw new UsageError('delete-company 需要公司 ID')
  if (args.flags.get('yes') !== true) throw new UsageError('删除是危险操作，请加 --yes 确认')
  const cur = db.prepare('SELECT id FROM companies WHERE id=?').get(id)
  if (!cur) throw new BizError(`公司 #${id} 不存在`)
  for (const sql of [
    'DELETE FROM companies WHERE id=?',
    'DELETE FROM positions WHERE company_id=?',
    'DELETE FROM tags WHERE company_id=?',
    'DELETE FROM applications WHERE company_id=?',
    'DELETE FROM chats WHERE company_id=?',
  ]) db.prepare(sql).run(id)
  emit(io, json, { id, ok: true }, (d) => `已删除公司 #${d.id} 及其全部关联数据`)
}

async function cmdTag(db, args, io, json) {
  const id = Number(args.positional[0])
  const tag = args.positional[1]
  if (!Number.isInteger(id) || !tag) throw new UsageError('tag 需要公司 ID 和标签')
  const cur = db.prepare('SELECT id FROM companies WHERE id=?').get(id)
  if (!cur) throw new BizError(`公司 #${id} 不存在`)
  db.prepare('INSERT OR IGNORE INTO tags(company_id,tag) VALUES(?,?)').run(id, tag.trim())
  emit(io, json, { id, tag, ok: true }, (d) => `已为公司 #${d.id} 打标签: ${d.tag}`)
}

async function cmdAddPosition(db, args, io, json) {
  const companyId = Number(args.positional[0])
  const title = args.positional[1]
  if (!Number.isInteger(companyId) || !title) throw new UsageError('add-position 需要公司 ID 和岗位名称')
  const cur = db.prepare('SELECT id FROM companies WHERE id=?').get(companyId)
  if (!cur) throw new BizError(`公司 #${companyId} 不存在`)
  const f = (k) => typeof args.flags.get(k) === 'string' ? args.flags.get(k) : null
  const info = db.prepare(
    'INSERT INTO positions(company_id,title,salary_min,salary_max,salary_note,location,work_type,hr_contact,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
  ).run(companyId, title, f('salary-min'), f('salary-max'), f('salary-note'), f('location'), f('work-type'), f('hr'), f('note'), now())
  const id = Number(info.lastInsertRowid)
  emit(io, json, { id, company_id: companyId, title }, (d) => `已添加岗位 #${d.id} ${d.title}`)
}

async function cmdUpdatePosition(db, args, io, json) {
  const id = Number(args.positional[0])
  if (!Number.isInteger(id)) throw new UsageError('update-position 需要岗位 ID')
  const cur = db.prepare('SELECT * FROM positions WHERE id=?').get(id)
  if (!cur) throw new BizError(`岗位 #${id} 不存在`)
  const f = (k, curVal) => {
    const v = args.flags.get(k)
    if (v === true || v === undefined) return curVal
    return v === '' ? null : v
  }
  db.prepare(
    'UPDATE positions SET title=?,salary_min=?,salary_max=?,salary_note=?,location=?,work_type=?,hr_contact=?,note=? WHERE id=?'
  ).run(
    f('title', cur.title), f('salary-min', cur.salary_min), f('salary-max', cur.salary_max),
    f('salary-note', cur.salary_note), f('location', cur.location), f('work-type', cur.work_type),
    f('hr', cur.hr_contact), f('note', cur.note), id
  )
  emit(io, json, { id, ok: true }, (d) => `已更新岗位 #${d.id}`)
}

async function cmdApply(db, args, io, json) {
  const companyId = Number(args.positional[0])
  if (!Number.isInteger(companyId)) throw new UsageError('apply 需要公司 ID')
  const cur = db.prepare('SELECT id FROM companies WHERE id=?').get(companyId)
  if (!cur) throw new BizError(`公司 #${companyId} 不存在`)
  const atFlag = args.flags.get('at')
  const appliedAt = typeof atFlag === 'string' ? Number(atFlag) : now()
  const f = (k) => typeof args.flags.get(k) === 'string' ? args.flags.get(k) : null
  db.prepare('INSERT INTO applications(company_id,applied_at,channel,note) VALUES(?,?,?,?)')
    .run(companyId, appliedAt, f('channel'), f('note'))
  emit(io, json, { company_id: companyId, ok: true }, (d) => `已记录投递: 公司 #${d.company_id}`)
}

async function cmdChat(db, args, io, json) {
  const companyId = Number(args.positional[0])
  if (!Number.isInteger(companyId)) throw new UsageError('chat 需要公司 ID')
  const cur = db.prepare('SELECT id FROM companies WHERE id=?').get(companyId)
  if (!cur) throw new BizError(`公司 #${companyId} 不存在`)
  const role = args.flags.get('role')
  if (role !== '我方' && role !== '对方') throw new UsageError('chat 需要 --role 我方|对方')
  let content = args.flags.get('content')
  if (content === '-') content = (await io.stdin()).trim()
  if (typeof content !== 'string' || !content.trim()) throw new UsageError('chat 需要 --content 内容（或用 --content - 从标准输入读取）')
  const contact = typeof args.flags.get('contact') === 'string' ? args.flags.get('contact') : null
  const platform = typeof args.flags.get('platform') === 'string' ? args.flags.get('platform') : null
  const pidFlag = args.flags.get('position-id')
  const positionId = typeof pidFlag === 'string' ? Number(pidFlag) : null
  const atFlag = args.flags.get('at')
  const createdTs = typeof atFlag === 'string' ? Number(atFlag) : now()
  const info = db.prepare(
    'INSERT INTO chats(company_id,position_id,platform,contact,role,content,created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(companyId, positionId, platform, contact, role, content.trim(), createdTs)
  const id = Number(info.lastInsertRowid)
  emit(io, json, { id, company_id: companyId, ok: true }, (d) => `已录入对话 #${d.id}`)
}

async function scoreWithDeepSeek(db, ctx) {
  const apiKey = getSetting(db, 'api_key')
  if (!apiKey) throw new BizError('尚未配置 DeepSeek API Key（请在桌面应用 Settings 内填写后重试）')
  const base = (getSetting(db, 'base_url') || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = getSetting(db, 'model') || 'deepseek-chat'
  const c = ctx.company
  const userContent = JSON.stringify({
    公司名称: c.name,
    所属行业: c.industry,
    公司简介: c.description,
    网站: c.website,
    公司地址: c.address,
    联系人: c.contact,
    岗位: ctx.positions.map((p) => `${p.title}${p.hr_contact ? `(对接HR:${p.hr_contact})` : ''} ${p.salary_min ?? ''}-${p.salary_max ?? ''}`),
    标签: ctx.tags,
    投递次数: ctx.applyCount,
    对话: ctx.chats.map((m) => `[${m.role}${m.contact ? `/${m.contact}` : ''}] ${m.content}`),
  })
  const systemPrompt =
    '你是一位求职风险评估顾问，专门识别招聘骗局。只输出 JSON {score(0-100整数, 风险评分, 分数越高代表风险越大), summary(≤60字), risk_level(低/中/高/极高), detail(<200字)}，不要输出多余内容。'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  let resp
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) throw new BizError(`DeepSeek API ${resp.status}: ${await resp.text()}`)
  const data = await resp.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  const out = JSON.parse(text)
  const riskScore = Math.min(100, Math.max(0, Number(out.score) || 0))
  return {
    score: 100 - riskScore, // 综合评分：越高越安全（风险分取反）
    risk_level: out.risk_level || '未知',
    summary: out.summary || '',
    detail: out.detail || '',
  }
}

async function cmdScore(db, args, io, json) {
  const id = Number(args.positional[0])
  if (!Number.isInteger(id)) throw new UsageError('score 需要公司 ID')
  const ctx = companyContext(db, id)
  if (!ctx) throw new BizError(`公司 #${id} 不存在`)
  const r = await scoreWithDeepSeek(db, ctx)
  db.prepare('UPDATE companies SET ai_score=?,ai_summary=?,ai_detail=?,risk_level=?,updated_at=? WHERE id=?')
    .run(r.score, r.summary, r.detail, r.risk_level, now(), id)
  emit(io, json, { id, ...r }, (d) => `评分完成: ${d.score}/100（越高越安全）风险:${d.risk_level} —— ${d.summary}`)
}

async function cmdDb(db, args, io, json) {
  const path = args._dbPath ?? defaultDbPath()
  emit(io, json, { path }, (d) => d.path)
}

async function cmdDoctor(db, args, io, json) {
  const report = {
    node: process.version,
    sqlite_ok: true,
    db_path: args._dbPath ?? defaultDbPath(),
    tables: db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map((r) => r.name).filter((n) => n !== 'sqlite_sequence'),
    api_key_configured: Boolean(getSetting(db, 'api_key')),
    model: getSetting(db, 'model') || 'deepseek-chat (默认)',
  }
  emit(io, json, report, (d) => {
    const s = []
    s.push(`Node: ${d.node}`)
    s.push(`SQLite: ${d.sqlite_ok ? '可用' : '不可用'}`)
    s.push(`数据库: ${d.db_path}`)
    s.push(`数据表: ${d.tables.join(', ')}`)
    s.push(`DeepSeek API Key: ${d.api_key_configured ? '已配置' : '未配置（score 不可用）'}`)
    s.push(`模型: ${d.model}`)
    return s.join('\n')
  })
}

// ---------- 错误类型 ----------
class UsageError extends Error { constructor(m) { super(m); this.code = 2 } }
class BizError extends Error { constructor(m) { super(m); this.code = 1 } }

// ---------- 命令路由 ----------
const COMMANDS = {
  list: cmdList,
  get: cmdGet,
  'add-company': cmdAddCompany,
  'update-company': cmdUpdateCompany,
  'delete-company': cmdDeleteCompany,
  tag: cmdTag,
  'add-tag': cmdTag,
  'add-position': cmdAddPosition,
  'update-position': cmdUpdatePosition,
  apply: cmdApply,
  chat: cmdChat,
  score: cmdScore,
  db: cmdDb,
  doctor: cmdDoctor,
}

export async function main(argv, io = realIo) {
  const args = parseArgs(argv)
  if (args.flags.get('help') === true || args.flags.get('h') === true || argv.length === 0) {
    out(io, HELP)
    return 0
  }
  if (args.flags.get('version') === true) {
    out(io, VERSION)
    return 0
  }
  const json = args.flags.get('json') === true
  const cmdName = args.positional.shift()
  const fn = COMMANDS[cmdName]
  if (!fn) {
    err(io, `未知子命令: ${cmdName ?? '(空)'}（--help 查看用法）`)
    return 2
  }
  // 数据库路径：显式 --db > 环境变量（db.mjs 内部处理）
  const dbFlag = args.flags.get('db')
  const dbPath = typeof dbFlag === 'string' ? dbFlag : defaultDbPath()
  args._dbPath = dbPath
  let db;
  try {
    db = openDatabase(dbPath)
    await fn(db, args, io, json)
    return 0
  } catch (e) {
    if (e instanceof UsageError) {
      err(io, `参数错误: ${e.message}`)
      err(io, '（--help 查看用法）')
      return 2
    }
    if (e instanceof BizError) {
      err(io, e.message)
      return 1
    }
    err(io, `错误: ${e?.message ?? e}`)
    return 1
  } finally {
    try { db?.close() } catch {}
  }
}

// 作为脚本直接运行时启动
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]).href)
if (isEntry) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}