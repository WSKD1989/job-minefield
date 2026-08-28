// ==UserScript==
// @name         应聘避坑小工具 · BOSS直聘会话采集
// @namespace    job-minefield
// @version      1.0.0
// @description  在 BOSS直聘 聊天页一键采集当前会话（消息/职位/公司），导出 JSON 供「应聘避坑小工具」的 import-capture 工具导入；聊天页采集消息，职位页采集岗位，公司页采集公司信息。
// @match        https://www.zhipin.com/web/geek/chat*
// @match        https://www.zhipin.com/web/geek/job*
// @match        https://www.zhipin.com/job_detail/*
// @match        https://www.zhipin.com/gongsi/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  const PLATFORM = 'BOSS直聘'
  const DEBUG = false

  // ---------- 工具 ----------
  const $ = (s, root) => (root || document).querySelector(s)
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s))
  const txt = (el) => (el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const log = (...a) => DEBUG && console.log('[boss-capture]', ...a)

  function firstText(selectors, root) {
    for (const s of selectors) {
      const el = $(s, root)
      const t = txt(el)
      if (t) return t
    }
    return ''
  }

  // ---------- 消息解析（多策略，best-effort） ----------
  const MSG_SELECTORS = [
    '.chat-message',
    '.message-item',
    '.msg-item',
    '.chat-item',
    '[class*="chat-message"]',
    '[class*="message-item"]',
    '[class*="chat-item"]',
  ]
  const MINE_HINTS = ['mine', 'self', 'my-', 'right', 'send', 'outgoing']
  const THEIRS_HINTS = ['other', 'them', 'left', 'receive', 'incoming', 'opposite']

  function roleOf(el) {
    const cls = (el.className && String(el.className)) || ''
    const low = cls.toLowerCase()
    for (const h of MINE_HINTS) if (low.includes(h)) return '我方'
    for (const h of THEIRS_HINTS) if (low.includes(h)) return '对方'
    // 视觉对齐判断：消息主体靠近容器右侧视为我方
    const c = el.closest('[class*="chat"], [class*="message"], [class*="dialog"], [class*="list"]')
    if (c) {
      const r = el.getBoundingClientRect()
      const cr = c.getBoundingClientRect()
      if (r.width > 0 && cr.width > 0) {
        const rightGap = cr.right - r.right
        const leftGap = r.left - cr.left
        if (Math.abs(rightGap - leftGap) > 40) return rightGap < leftGap ? '我方' : '对方'
      }
    }
    return '对方'
  }

  function messageTextOf(el) {
    // 优先取文本节点，跳过时间戳等小元素
    const t = txt(el)
    return t
  }

  function parseMessages() {
    const nodes = []
    for (const s of MSG_SELECTORS) {
      const found = $$(s)
      if (found.length > nodes.length) {
        nodes.length = 0
        nodes.push(...found)
      }
    }
    log('message nodes:', nodes.length)
    // 去重 + 只保留最内层节点（避免父子都匹配同一选择器）
    const msgs = []
    for (const el of nodes) {
      if (nodes.some((other) => other !== el && el.contains(other))) continue
      const content = messageTextOf(el)
      if (!content) continue
      msgs.push({ role: roleOf(el), content })
    }
    return msgs
  }

  // ---------- 页面信息采集 ----------
  function collect() {
    const out = { platform: PLATFORM, source_url: location.href, captured_at: Math.floor(Date.now() / 1000) }

    // 头部：HR / 会话名 / 职位标题
    const hr = firstText([
      '.chat-header [class*="name"]', '.chat-title', '.conversation-title',
      '.header [class*="name"]', '[class*="chat-header"] [class*="name"]',
    ])
    if (hr) out.hr = hr.replace(/^(和|与)\s*/, '').split('·')[0].trim()

    // 职位标题 + 薪资
    const jobTitle = firstText([
      '.chat-header [class*="job"]', '.job-title', '[class*="chat-header"] [class*="job"]',
      '.job-detail-title', '[class*="job-name"]',
    ])
    const salary = firstText([
      '.chat-header [class*="salary"]', '[class*="chat-header"] [class*="salary"]',
      '.job-detail [class*="salary"]', '[class*="salary"]',
    ])
    if (jobTitle || salary) {
      out.job = {}
      if (jobTitle) out.job.title = jobTitle.trim()
      if (salary) out.job.salary = salary.trim()
    }

    // 消息
    const msgs = parseMessages()
    if (msgs.length) {
      // 压缩：每条 ≤120 字，最多 12 条
      out.messages = msgs.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 120) }))
    }

    // 职位详情页：标题/薪资/经验学历/JD
    if (/job_detail|geek\/job/.test(location.href)) {
      out.job = out.job || {}
      const title = firstText(['.job-detail-title', '.name h1', '[class*="job-title"]'])
      if (title && !out.job.title) out.job.title = title
      const jd = firstText(['.job-detail-section', '.job-sec-text', '[class*="job-description"]'])
      if (jd) out.job.jd = jd.slice(0, 800)
      const meta = firstText(['.job-detail .info', '.job-detail [class*="info"]'])
      if (meta && !out.job.title) { const p = meta.split(/[|·]/); out.job.experience = (p[0] || '').trim() }
    }

    // 公司页：名称/行业/融资/规模/简介
    if (/gongsi/.test(location.href)) {
      out.company = out.company || {}
      const name = firstText(['.company-name', '.name', 'h1'])
      if (name && !out.company.name) out.company.name = name
      const tags = firstText(['.company-tag', '.company-info [class*="tag"]'])
      if (tags) { const parts = tags.split(/[|·]/).map(s => s.trim()).filter(Boolean); out.company.industry = (parts[0] || '') }
      const intro = firstText(['.company-intro', '.company-description', '.detail-content'])
      if (intro) out.company.intro = intro.slice(0, 300)
    }

    // 兜底：从聊天页的会话列表识别公司名
    if (!out.company) {
      const conv = firstText(['.conversation-item .name', '.chat-list [class*="name"]'])
      if (conv) out.company = { name: conv }
    }
    return out
  }

  // ---------- 导出：复制 / 下载 ----------
  function copyText(text) {
    return new Promise((resolve) => {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text); return resolve(true) }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(() => resolve(true), () => resolve(fallbackCopy(text)))
      }
      resolve(fallbackCopy(text))
    })
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch { return false }
  }
  function download(text, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  // ---------- UI ----------
  function ensureUi() {
    if (document.getElementById('bk-capture-btn')) return
    const style = document.createElement('style')
    style.textContent = `
      #bk-capture-btn{position:fixed;right:18px;bottom:70px;z-index:2147483000;background:#4f6ef7;color:#fff;border:none;border-radius:999px;padding:9px 16px;font:600 13px/1.4 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(79,110,247,.35)}
      #bk-capture-panel{position:fixed;right:18px;bottom:120px;z-index:2147483000;width:420px;max-width:92vw;max-height:70vh;display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #e2e6ef;border-radius:14px;padding:12px;box-shadow:0 8px 30px rgba(20,30,60,.18);font:13px/1.5 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#181d2b}
      #bk-capture-panel textarea{width:100%;min-height:160px;resize:vertical;border:1px solid #e2e6ef;border-radius:8px;padding:8px;font:12px/1.5 ui-monospace,Consolas,monospace}
      #bk-capture-panel .bk-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      #bk-capture-panel input{flex:1;min-width:100px;border:1px solid #e2e6ef;border-radius:8px;padding:6px 8px;font:inherit}
      #bk-capture-panel button{border:none;border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer}
      #bk-capture-panel .bk-primary{background:#4f6ef7;color:#fff}
      #bk-capture-panel .bk-soft{background:#eef1fe;color:#4f6ef7}
      #bk-capture-panel .bk-hint{color:#9ca3b4;font-size:11px}
      #bk-capture-panel .bk-title{font-weight:600}
    `
    document.head.appendChild(style)

    const btn = document.createElement('button')
    btn.id = 'bk-capture-btn'
    btn.textContent = '📋 采集会话'
    btn.onclick = openPanel
    document.body.appendChild(btn)
  }

  function buildLines(data) {
    // 可编辑预览：一行一条 [角色] 消息（与应用内批量导入格式一致）
    const lines = []
    if (data.hr) lines.push('HR: ' + data.hr)
    if (data.job && (data.job.title || data.job.salary)) lines.push('职位: ' + [data.job.title, data.job.salary].filter(Boolean).join(' '))
    if (data.company && data.company.name) lines.push('公司: ' + data.company.name)
    if (data.job && data.job.jd) lines.push('JD: ' + data.job.jd)
    if (data.company && data.company.intro) lines.push('简介: ' + data.company.intro)
    if (data.messages && data.messages.length) {
      lines.push('')
      for (const m of data.messages) lines.push('[' + m.role + '] ' + m.content)
    }
    return lines.join('\n')
  }

  let panel = null
  function openPanel() {
    const data = collect()
    panel = document.createElement('div')
    panel.id = 'bk-capture-panel'
    panel.innerHTML = `
      <div class="bk-row bk-title">采集结果（请核对，可编辑）</div>
      <textarea spellcheck="false"></textarea>
      <div class="bk-hint">消息格式：一行一条，[对方]/[我方] 前缀；可增删改。右上角可调整顺序后重新解析。</div>
      <div class="bk-row">
        <button class="bk-soft" id="bk-reparse">重新解析</button>
        <button class="bk-soft" id="bk-download">下载 JSON</button>
        <button class="bk-primary" id="bk-copy">复制 JSON</button>
        <button class="bk-soft" id="bk-close">关闭</button>
      </div>
    `
    document.body.appendChild(panel)
    const ta = panel.querySelector('textarea')
    ta.value = buildLines(data)

    // 行文本 → 结构化 JSON
    const toJson = () => {
      const d = { platform: PLATFORM, source_url: location.href, captured_at: Math.floor(Date.now() / 1000) }
      let hr = '', jobTitle = '', salary = '', companyName = '', jd = '', intro = ''
      const messages = []
      for (const raw of ta.value.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        let m = line.match(/^\[(对方|我方)\](.*)$/)
        if (m) { messages.push({ role: m[1], content: m[2].trim().slice(0, 120) }); continue }
        m = line.match(/^HR[:：]\s*(.*)$/)
        if (m) { hr = m[1].trim(); continue }
        m = line.match(/^职位[:：]\s*(.*)$/)
        if (m) { const p = m[1].split(/\s+/); jobTitle = p.shift() || ''; salary = p.join(' ') || ''; continue }
        m = line.match(/^公司[:：]\s*(.*)$/)
        if (m) { companyName = m[1].trim(); continue }
        m = line.match(/^JD[:：]\s*([\s\S]*)$/)
        if (m) { jd = (jd ? jd + '\n' : '') + m[1].trim(); continue }
        m = line.match(/^简介[:：]\s*([\s\S]*)$/)
        if (m) { intro = (intro ? intro + '\n' : '') + m[1].trim(); continue }
      }
      if (hr) d.hr = hr
      if (jobTitle || salary) d.job = { title: jobTitle, salary: salary, jd: jd || undefined }
      if (companyName) d.company = { name: companyName, intro: intro || undefined }
      if (messages.length) d.messages = messages
      return d
    }

    panel.querySelector('#bk-reparse').onclick = () => { ta.value = buildLines(collect()) }
    panel.querySelector('#bk-download').onclick = () => {
      download(JSON.stringify(toJson(), null, 2), 'boss-capture-' + Date.now() + '.json')
    }
    panel.querySelector('#bk-copy').onclick = async () => {
      const ok = await copyText(JSON.stringify(toJson(), null, 2))
      const b = document.getElementById('bk-capture-btn')
      if (b) { b.textContent = ok ? '✅ 已复制' : '❌ 复制失败，请用下载'; setTimeout(() => { b.textContent = '📋 采集会话' }, 1500) }
    }
    panel.querySelector('#bk-close').onclick = () => { document.body.removeChild(panel); panel = null }
  }

  // 页面为 SPA，等待路由稳定后注入按钮
  function init() {
    if (/zhipin\.com\/(web\/geek\/(chat|job)|job_detail|gongsi)/.test(location.href)) ensureUi()
  }
  setTimeout(init, 1200)
  let lastUrl = location.href
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(init, 1200) }
  }, 1500)
})()
