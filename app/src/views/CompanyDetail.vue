<script setup lang="ts">
// 公司详情：基本信息 / 标签 / 岗位 / 投递记录 / 沟通对话 / AI 评分
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, Sparkles, Plus, Trash2, Pencil, Save, X, Building2,
  MapPin, UserRound, ScanText, Send, GitCommitHorizontal, Tags, Loader2, Link2, ClipboardList, Landmark, Ban,
} from '@lucide/vue'
import { api } from '../api'
import { confirm, toast } from '../ui'
import { ocrImage } from '../ocr'
import { PRESET_TAGS, WORK_TYPES, type CompanyDetail as CD } from '../types'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const detail = ref<CD | null>(null)
const loading = ref(true)
const scoring = ref(false)

// ---------- 数据 ----------
async function load() {
  loading.value = true
  try {
    const d = await api.getCompany(id)
    if (!d) {
      router.push('/')
      return
    }
    detail.value = d
  } finally {
    loading.value = false
  }
}

// ---------- AI 评分 ----------
async function doScore() {
  scoring.value = true
  try {
    await api.scoreCompany(id)
    await load()
  } catch (e) {
    toast(`评分失败：${e}`, 'error')
  } finally {
    scoring.value = false
  }
}

// ---------- 不再沟通 ----------
async function toggleNoContact() {
  if (!detail.value) return
  const next = !detail.value.company.no_contact
  await api.updateCompany(id, { name: detail.value.company.name, no_contact: next })
  toast(next ? '已标记为不再沟通' : '已恢复沟通', 'info')
  await load()
}

function scoreColor(c: CD['company']): string {
  const s = c.ai_score ?? -1
  if (s < 0) return 'var(--color-border)'
  if (s >= 80) return 'var(--color-success)'
  if (s >= 60) return 'var(--color-primary)'
  if (s >= 40) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

// ---------- 标签 ----------
const newTag = ref('')
async function addTag() {
  const t = newTag.value.trim()
  if (!t) return
  await api.addTag(id, t)
  newTag.value = ''
  await load()
}
async function removeTag(t: string) {
  await api.removeTag(id, t)
  await load()
}

// 预置但未打的标签，用于快捷添加
const presetToAdd = computed(() =>
  PRESET_TAGS.filter((t) => !detail.value?.tags.includes(t) && newTag.value === ''),
)

// ---------- 岗位 ----------
const posForm = reactive({
  id: 0,
  title: '',
  salary_min: '',
  salary_max: '',
  salary_note: '',
  location: '',
  work_type: 'onsite',
  hr_contact: '',
  note: '',
})
const showPosForm = ref(false)

function editPos(i: number) {
  const p = detail.value!.positions[i]
  Object.assign(posForm, {
    id: p.id, title: p.title, salary_min: p.salary_min ?? '',
    salary_max: p.salary_max ?? '', salary_note: p.salary_note ?? '',
    location: p.location ?? '', work_type: p.work_type ?? 'onsite',
    hr_contact: p.hr_contact ?? '', note: p.note ?? '',
  })
  showPosForm.value = true
}

async function savePos() {
  const input = {
    company_id: id,
    title: posForm.title,
    salary_min: posForm.salary_min || null,
    salary_max: posForm.salary_max || null,
    salary_note: posForm.salary_note || null,
    location: posForm.location || null,
    work_type: posForm.work_type,
    hr_contact: posForm.hr_contact || null,
    note: posForm.note || null,
  }
  if (posForm.id) await api.updatePosition(posForm.id, input)
  else await api.addPosition(input)
  resetPos()
  await load()
}

function resetPos() {
  Object.assign(posForm, {
    id: 0, title: '', salary_min: '', salary_max: '', salary_note: '',
    location: '', work_type: 'onsite', hr_contact: '', note: '',
  })
  showPosForm.value = false
}

async function delPos(i: number) {
  const p = detail.value!.positions[i]
  if (await confirm(`删除岗位「${p.title}」？关联的对话记录不会删除。`)) {
    await api.deletePosition(p.id)
    toast('岗位已删除', 'success')
    await load()
  }
}

// ---------- 执行过程日志（终端式过程显示） ----------
const importLogs = ref<string[]>([])
function logs(msg: string) {
  importLogs.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

// ---------- 招聘链接 / AI 解析录入 ----------
const showImport = ref(false)
const urlSource = ref('')
const urlBusy = ref(false)
const rawText = ref('')
const showRawText = ref(false)

// 用 AI 解析文本并回填岗位表单
async function parseAndFill(text: string) {
  logs(`调用 DeepSeek 解析岗位字段…（可能需要 10~60 秒）`)
  const parsed = await api.aiParseJob(text)
  const wt = ['onsite', 'remote', 'hybrid'].includes(parsed.work_type) ? parsed.work_type : 'onsite'
  Object.assign(posForm, {
    title: parsed.title ?? '',
    salary_min: parsed.salary_min ?? '',
    salary_max: parsed.salary_max ?? '',
    salary_note: parsed.salary_note ?? '',
    location: parsed.location ?? '',
    work_type: wt,
    hr_contact: parsed.hr_contact ?? '',
    note: parsed.note ?? '',
  })
  logs(`解析完成：岗位「${posForm.title || '（未识别）'}」已填入下方表单，请核对后保存`)
  showPosForm.value = true
}

// 抓取招聘 URL -> AI 解析 -> 回填
async function importFromUrl() {
  const u = urlSource.value.trim()
  if (!u) return
  urlBusy.value = true
  importLogs.value = []
  let renderErr = ''
  try {
    // 优先无头浏览器渲染抓取（对需 JS 渲染/反爬的 BOSS/智联等更有效），失败再退普通抓取
    let text: string
    try {
      logs(`启动无头浏览器渲染抓取…（${u}）`)
      text = await api.renderUrlText(u)
      logs(`渲染抓取完成，获取 ${text.length} 字符`)
    } catch (e) {
      renderErr = String(e)
      logs(`渲染抓取失败：${e}，回退普通抓取…`)
      text = await api.fetchUrlText(u)
      logs(`普通抓取完成，获取 ${text.length} 字符`)
    }
    const preview = text.replace(/\s+/g, ' ').slice(0, 120)
    await parseAndFill(text)
    // 解析为空时诊断：大概率是页面需登录/验证码
    if (!posForm.title) {
      importLogs.value.push(`❗ 未识别到岗位，抓取内容开头：${preview || '(空)'}`)
      toast(
        `未解析出岗位信息。抓取到的内容开头：${preview || '(空)'}\n提示：BOSS/智联等招聘详情通常需登录后才可见，无登录态抓取到的是登录/验证页。请改为「粘贴文本解析」或登录后重试。`,
        'error',
      )
    }
  } catch (e) {
    importLogs.value.push(`❗ 失败：${e}`)
    toast(`抓取/解析失败：${e}${renderErr ? `\n渲染抓取错误：${renderErr}` : ''}\n可尝试「粘贴文本解析」。`, 'error')
  } finally {
    urlBusy.value = false
    logs('本次导入结束')
  }
}

// 直接粘贴 JD 文本 -> AI 解析 -> 回填
async function importFromText() {
  if (!rawText.value.trim()) return
  urlBusy.value = true
  importLogs.value = []
  try {
    logs(`粘贴文本共 ${rawText.value.trim().length} 字符`)
    await parseAndFill(rawText.value.trim())
  } catch (e) {
    importLogs.value.push(`❗ 失败：${e}`)
    toast(`解析失败：${e}`, 'error')
  } finally {
    urlBusy.value = false
    logs('本次导入结束')
  }
}

// ---------- 对话批量导入 ----------
const showBatch = ref(false)
const batchText = ref('')
async function importBatchChat() {
  const lines = batchText.value.split('\n')
  const msgs: { role: string; content: string }[] = []
  let autoRole: '对方' | '我方' = '对方'
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^\[(对方|我方)\](.*)$/)
    if (match) {
      msgs.push({ role: match[1], content: match[2].trim() })
    } else {
      msgs.push({ role: autoRole, content: line })
      autoRole = autoRole === '对方' ? '我方' : '对方'
    }
  }
  for (const m of msgs) {
    if (!m.content) continue
    await api.addChat({ company_id: id, position_id: null, platform: null, contact: null, role: m.role, content: m.content })
  }
  batchText.value = ''
  showBatch.value = false
  await load()
  toast(`已导入 ${msgs.filter((m) => m.content).length} 条对话`, 'success')
}

// ---------- 投递记录 ----------
const appInput = reactive({ date: todayStr(), channel: '', note: '' })
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
async function addApp() {
  await api.addApplication({
    company_id: id,
    applied_at: new Date(appInput.date).getTime() / 1000,
    channel: appInput.channel || null,
    note: appInput.note || null,
  })
  appInput.channel = ''
  appInput.note = ''
  await load()
}
async function delApp(i: number) {
  const a = detail.value!.applications[i]
  if (await confirm(`删除 ${fmtDate(a.applied_at)} 的这条投递记录？`)) {
    await api.deleteApplication(a.id)
    toast('投递记录已删除', 'success')
    await load()
  }
}

// ---------- 对话 ----------
const chatForm = reactive({ position_id: null as number | null, platform: '', contact: '', role: '对方', content: '' })
const ocrInput = ref<HTMLInputElement | null>(null)
const ocrBusy = ref(false)
async function addChat() {
  if (!chatForm.content.trim()) return
  await api.addChat({
    company_id: id,
    position_id: chatForm.position_id,
    platform: chatForm.platform || null,
    contact: chatForm.contact || null,
    role: chatForm.role,
    content: chatForm.content.trim(),
  })
  chatForm.content = ''
  await load()
}
async function delChat(i: number) {
  const m = detail.value!.chats[i]
  if (await confirm('删除这条对话记录？')) {
    await api.deleteChat(m.id)
    toast('对话已删除', 'success')
    await load()
  }
}
// 对话关联岗位的标题
function chatPositionTitle(pid: number | null): string {
  if (!pid) return ''
  return detail.value?.positions.find((p) => p.id === pid)?.title ?? ''
}

// ---------- 爱企查工商信息 ----------
const showBiz = ref(false)
const bizQuery = ref('')
const bizUrl = ref('')
const bizBusy = ref(false)
// 抓取结果 -> AI 解析 -> 写回
async function runBiz(text: string) {
  bizBusy.value = true
  try {
    await api.queryBiz(id, text)
    await load()
    showBiz.value = false
    toast('已获取并写入工商信息', 'success')
  } catch (e) {
    toast(`获取工商信息失败：${e}\n该站点可能需登录或有反爬限制，请确认链接有效后重试。`, 'error')
  } finally {
    bizBusy.value = false
  }
}
async function queryBizInfo() {
  const query = bizQuery.value.trim() || detail.value?.company.name || ''
  if (!query) return
  bizBusy.value = true
  try {
    const raw = await api.fetchAiqicha(query)
    await runBiz(raw)
  } catch (e) {
    toast(`搜索并获取工商信息失败：${e}\n可改用手动粘贴企业详情链接。`, 'error')
    bizBusy.value = false
  }
}
// 识别站点来源（用于解析提示）
function bizSiteLabel(u: string): string {
  const s = u.toLowerCase()
  if (s.includes('aiqicha.baidu.com')) return '爱企查'
  if (s.includes('qcc.com')) return '企查查'
  if (s.includes('tianyancha.com')) return '天眼查'
  return ''
}

// 手动粘贴爱企查/企查查/天眼查详情 URL 录入
async function queryBizByUrl() {
  const u = bizUrl.value.trim()
  if (!u) return
  bizBusy.value = true
  try {
    // 优先无头浏览器渲染抓取，失败退站点专用抓取
    let raw: string
    try {
      raw = await api.renderUrlText(u)
    } catch {
      raw = await api.fetchBizUrl(u)
    }
    const site = bizSiteLabel(u)
    // 注入站点来源提示，提升 AI 解析准确度
    const text = site ? `【该文本抓自${site}企业详情页】\n${raw}` : raw
    await api.queryBiz(id, text)
    await load()
    showBiz.value = false
    toast(`已从${site || '该'}链接解析并写入工商信息`, 'success')
  } catch (e) {
    toast(`链接抓取/解析失败：${e}\n该站点可能需登录或有反爬限制，请确认链接有效后重试。`, 'error')
  } finally {
    bizBusy.value = false
  }
}
// OCR 识别聊天截图并填入输入框
async function onOcrChat(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ocrBusy.value = true
  try {
    const text = await ocrImage(file)
    chatForm.content = text
  } catch (err) {
    toast(`OCR 识别失败：${err}`, 'error')
  } finally {
    ocrBusy.value = false
    if (ocrInput.value) ocrInput.value.value = ''
  }
}

// ---------- 删除公司 ----------
async function delCompany() {
  if (await confirm('删除该公司及其全部关联数据？')) {
    await api.deleteCompany(id)
    router.push('/')
  }
}

// ---------- 展示辅助 ----------
function fmtDate(ts: number) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function salaryText(p: CD['positions'][number]) {
  const lo = p.salary_min || '面议'
  const hi = p.salary_max || ''
  return hi ? `${lo} - ${hi}` : lo
}
function fmtDatetime(ts: number) {
  const d = new Date(ts * 1000)
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${md} ${hm}`
}
function workTypeLabel(v: string | null) {
  return WORK_TYPES.find((w) => w.value === v)?.label ?? v ?? ''
}

onMounted(load)
</script>

<template>
  <div v-if="loading" class="skeleton-page">
    <div class="skeleton-head">
      <div class="skeleton-circle"></div>
      <div class="skeleton-lines">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-40"></div>
      </div>
    </div>
    <div class="skeleton-block">
      <div class="skeleton-line w-30"></div>
      <div class="skeleton-line w-80"></div>
      <div class="skeleton-line w-50"></div>
    </div>
    <div class="skeleton-grid">
      <div class="skeleton-block">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-70"></div>
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-45"></div>
      </div>
      <div class="skeleton-block">
        <div class="skeleton-line w-35"></div>
        <div class="skeleton-line w-75"></div>
        <div class="skeleton-line w-55"></div>
      </div>
    </div>
  </div>
  <template v-else-if="detail">
    <div class="page">
      <!-- 头部 -->
      <div class="head">
        <button class="icon-btn" title="返回" @click="router.push('/')">
          <ArrowLeft :size="18" />
        </button>
        <div class="head-info">
          <div class="head-top">
            <h2>{{ detail.company.name }}</h2>
            <span v-if="detail.company.no_contact" class="no-contact-badge">不再沟通</span>
            <span class="score-badge" :style="{ background: scoreColor(detail.company) }">
              {{ detail.company.ai_score ?? '未评分' }}
            </span>
          </div>
          <p v-if="detail.company.industry" class="muted">{{ detail.company.industry }}</p>
        </div>
        <div class="head-actions">
          <button
            class="btn-soft"
            :class="{ 'no-contact-active': detail.company.no_contact }"
            :title="detail.company.no_contact ? '标记为恢复沟通' : '标记为不再沟通'"
            @click="toggleNoContact"
          >
            <Ban :size="15" />
            {{ detail.company.no_contact ? '恢复沟通' : '不再沟通' }}
          </button>
          <button class="btn-soft" :disabled="scoring" @click="doScore">
            <Loader2 v-if="scoring" :size="15" class="spin" />
            <Sparkles v-else :size="15" />
            {{ detail.company.ai_score != null ? '重新评分' : 'AI 评分' }}
          </button>
          <button class="icon-btn" title="编辑" @click="router.push(`/company/${id}/edit`)">
            <Pencil :size="17" />
          </button>
          <button class="icon-btn danger" title="删除" @click="delCompany">
            <Trash2 :size="17" />
          </button>
        </div>
      </div>

      <!-- AI 评分结果 -->
      <section v-if="detail.company.ai_summary" class="card ai-box">
        <div class="ai-title"><Sparkles :size="15" /> AI 评估</div>
        <p class="ai-summary">{{ detail.company.ai_summary }}</p>
        <p v-if="detail.company.ai_detail" class="ai-detail">{{ detail.company.ai_detail }}</p>
      </section>

      <div class="two-col">
        <!-- 左：基本信息 + 标签 + 岗位 -->
        <div class="col">
          <section class="card block">
            <div class="block-head">
              <h4><Building2 :size="15" /> 基本信息</h4>
              <button class="icon-btn" :class="{ active: showBiz }" title="查询爱企查工商信息" @click="showBiz = !showBiz">
                <Landmark :size="16" />
              </button>
            </div>

            <!-- 爱企查查询 -->
            <div v-if="showBiz" class="import-box">
              <div class="import-row">
                <input v-model="bizQuery" :placeholder="detail.company.name" />
                <button class="btn-soft" :disabled="bizBusy" @click="queryBizInfo">
                  <Loader2 v-if="bizBusy" :size="14" class="spin" />
                  <Landmark v-else :size="14" />
                  搜索并写入
                </button>
              </div>
              <p class="muted hint">按公司名抓取爱企查并用 AI 提取工商信息。</p>

              <div class="import-divider">或手动粘贴企业详情链接</div>
              <div class="import-row">
                <input v-model="bizUrl" placeholder="爱企查 / 企查查 / 天眼查 企业详情页 URL" />
                <button class="btn-soft" :disabled="bizBusy" @click="queryBizByUrl">
                  <Loader2 v-if="bizBusy" :size="14" class="spin" />
                  <Link2 v-else :size="14" />
                  解析该链接
                </button>
              </div>
              <p class="muted hint">粘贴企业在任意平台的企业详情页链接，直接抓取并 AI 解析工商信息。</p>
            </div>

            <!-- 已存的工商信息 -->
            <div v-if="detail.company.biz_info" class="biz-block">
              <div class="biz-title"><Landmark :size="14" /> 工商信息（爱企查）</div>
              <pre>{{ detail.company.biz_info }}</pre>
            </div>

            <dl class="kv">
              <template v-if="detail.company.website">
                <dt>网站</dt><dd><a :href="detail.company.website" target="_blank">{{ detail.company.website }}</a></dd>
              </template>
              <template v-if="detail.company.address">
                <dt>地址</dt><dd><MapPin :size="13" /> {{ detail.company.address }}</dd>
              </template>
              <template v-if="detail.company.contact">
                <dt>联系人</dt><dd><UserRound :size="13" /> {{ detail.company.contact }}</dd>
              </template>
              <template v-if="detail.company.risk_level || detail.company.risk_note">
                <dt>人工风险</dt>
                <dd><Tags :size="13" /> 风险{{ detail.company.risk_level || '—' }} · {{ detail.company.risk_note || '' }}</dd>
              </template>
              <template v-if="detail.company.description">
                <dt>简介</dt><dd>{{ detail.company.description }}</dd>
              </template>
              <template v-if="!detail.company.description && !detail.company.website && !detail.company.address && !detail.company.contact">
                <dd class="muted">暂无信息</dd>
              </template>
            </dl>
          </section>

          <section class="card block">
            <h4><Tags :size="15" /> 标签 <span class="muted">({{ detail.tags.length }})</span></h4>
            <div class="tag-list">
              <span v-for="t in detail.tags" :key="t" class="tag-chip">
                {{ t }}
                <button class="chip-x" title="移除" @click="removeTag(t)"><X :size="11" /></button>
              </span>
              <span v-if="detail.tags.length === 0" class="muted">未打标签</span>
            </div>
            <div class="tag-add">
              <input v-model="newTag" placeholder="自定义标签，回车添加" @keyup.enter="addTag" />
              <button class="btn-soft" @click="addTag"><Plus :size="14" /> 添加</button>
            </div>
            <div v-if="presetToAdd.length" class="preset">
              <button
                v-for="t in presetToAdd"
                :key="t"
                class="btn-soft chip-btn"
                @click="api.addTag(id, t).then(load)"
              >
                + {{ t }}
              </button>
            </div>
          </section>

          <section class="card block">
            <div class="block-head">
              <h4><GitCommitHorizontal :size="15" /> 应聘岗位</h4>
              <div class="head-tools">
                <button class="icon-btn" :class="{ active: showImport }" title="从招聘链接导入" @click="showImport = !showImport">
                  <Link2 :size="17" />
                </button>
                <button class="icon-btn" :class="{ active: showPosForm }" title="新增岗位" @click="showPosForm = !showPosForm">
                  <Plus :size="17" />
                </button>
              </div>
            </div>

            <!-- 从招聘链接导入 -->
            <div v-if="showImport" class="import-box">
              <div class="import-row">
                <input v-model="urlSource" placeholder="粘贴招聘链接（BOSS直聘 / 智联 / 前程无忧…）" />
                <button class="btn-soft" :disabled="urlBusy" @click="importFromUrl">
                  <Loader2 v-if="urlBusy" :size="14" class="spin" />
                  <Link2 v-else :size="14" />
                  抓取解析
                </button>
              </div>
              <div v-if="!showRawText" class="import-alt">
                <a @click.prevent="showRawText = true">抓取失败？复制 JD 文本直接解析</a>
              </div>
              <div v-else class="import-raw">
                <textarea v-model="rawText" rows="4" placeholder="粘贴岗位 JD / 招聘正文，AI 将提取字段…" />
                <button class="btn-soft" :disabled="urlBusy" @click="importFromText">
                  <Loader2 v-if="urlBusy" :size="14" class="spin" />
                  AI 解析
                </button>
              </div>
              <p v-if="showPosForm" class="muted hint">解析完成，已填入下方岗位表单，请核对后保存。</p>

              <!-- 执行过程显示（终端式） -->
              <div v-if="importLogs.length" class="term">
                <pre><template v-for="(l, i) in importLogs" :key="i">{{ l }}
</template></pre>
              </div>
            </div>

            <div v-if="showPosForm" class="pos-form">
              <input v-model="posForm.title" placeholder="职位名称 *" />
              <div class="pos-salary">
                <input v-model="posForm.salary_min" placeholder="薪资下限" />
                <input v-model="posForm.salary_max" placeholder="薪资上限" />
              </div>
              <div class="pos-salary">
                <input v-model="posForm.location" placeholder="工作地点" />
                <select v-model="posForm.work_type">
                  <option v-for="w in WORK_TYPES" :key="w.value" :value="w.value">{{ w.label }}</option>
                </select>
              </div>
              <input v-model="posForm.hr_contact" placeholder="对接 HR / 联系人（姓名、工号、微信）" />
              <input v-model="posForm.salary_note" placeholder="薪资备注（含绩效/补贴/五险一金等）" />
              <textarea v-model="posForm.note" rows="2" placeholder="岗位说明、JD、风险点" />
              <div class="foot-actions">
                <button class="btn-primary" @click="savePos"><Save :size="14" /> 保存</button>
                <button class="btn-soft" @click="resetPos">取消</button>
              </div>
            </div>

            <ul v-if="detail.positions.length" class="pos-list">
              <li v-for="(p, i) in detail.positions" :key="p.id" class="pos-item">
                <div class="pos-main">
                  <strong>{{ p.title }}</strong>
                  <span class="salary">{{ salaryText(p) }}</span>
                  <span v-if="workTypeLabel(p.work_type)" class="muted">{{ workTypeLabel(p.work_type) }}</span>
                </div>
                <div class="pos-sub">
                  <span v-if="p.location">{{ p.location }}</span>
                  <span v-if="p.hr_contact">对接 HR：{{ p.hr_contact }}</span>
                  <span v-if="p.salary_note">{{ p.salary_note }}</span>
                  <span v-if="p.note">{{ p.note }}</span>
                </div>
                <div class="actions">
                  <button class="icon-btn" title="编辑" @click="editPos(i)"><Pencil :size="15" /></button>
                  <button class="icon-btn danger" title="删除" @click="delPos(i)"><Trash2 :size="15" /></button>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <!-- 右：投递 + 对话 -->
        <div class="col">
          <section class="card block">
            <div class="block-head">
              <h4><Send :size="15" /> 投递记录 <span class="muted">({{ detail.apply_count }})</span></h4>
            </div>
            <ul v-if="detail.applications.length" class="app-list">
              <li v-for="(a, i) in detail.applications" :key="a.id">
                <span class="app-date">{{ fmtDate(a.applied_at) }}</span>
                <span v-if="a.channel" class="tag-chip">{{ a.channel }}</span>
                <span v-if="a.note" class="muted">{{ a.note }}</span>
                <button class="icon-btn danger" title="删除" @click="delApp(i)"><X :size="14" /></button>
              </li>
            </ul>
            <div class="app-add">
              <input type="date" v-model="appInput.date" />
              <input v-model="appInput.channel" placeholder="渠道（如 BOSS直聘）" />
              <input v-model="appInput.note" placeholder="备注" @keyup.enter="addApp" />
              <button class="btn-soft" @click="addApp"><Plus :size="14" /></button>
            </div>
          </section>

          <section class="card block chat-block">
            <div class="block-head">
              <h4><UserRound :size="15" /> 线上沟通对话 <span class="muted">({{ detail.chats.length }})</span></h4>
              <button class="icon-btn" :class="{ active: showBatch }" title="批量导入对话" @click="showBatch = !showBatch">
                <ClipboardList :size="17" />
              </button>
            </div>

            <!-- 批量导入 -->
            <div v-if="showBatch" class="import-box">
              <div class="import-raw">
                <textarea
                  v-model="batchText"
                  rows="5"
                  placeholder="每行一条对话。可用 [对方] / [我方] 前缀标注；无前缀将自动交替对方/我方。&#10;示例：&#10;[对方] 您好，方便周末面试吗？&#10;[我方] 可以，请问薪资范围？"
                />
                <button class="btn-soft" @click="importBatchChat"><Plus :size="14" /> 导入</button>
              </div>
            </div>

            <div class="chat-log">
              <div v-if="detail.chats.length === 0" class="empty small-btn">暂无对话，可文字录入或 OCR 截图；可关联某个岗位并填写对话对象(HR)</div>
              <div
                v-for="(m, i) in detail.chats"
                :key="m.id"
                class="chat-msg"
                :class="m.role === '我方' ? 'mine' : 'theirs'"
              >
                <div class="bubble">
                  <span class="head-meta">
                    <template v-if="m.role === '我方'">我</template>
                    <template v-else>{{ m.contact || '对方' }}</template>
                    <template v-if="m.platform"> · {{ m.platform }}</template>
                    <template v-if="chatPositionTitle(m.position_id)"> · {{ chatPositionTitle(m.position_id) }}</template>
                    <em>{{ fmtDatetime(m.created_at) }}</em>
                  </span>
                  <p>{{ m.content }}</p>
                </div>
                <button class="icon-btn danger" title="删除" @click="delChat(i)"><Trash2 :size="13" /></button>
              </div>
            </div>

            <div class="chat-input">
              <div class="chat-tools">
                <select v-model="chatForm.role">
                  <option>对方</option>
                  <option>我方</option>
                </select>
                <input v-model="chatForm.contact" placeholder="对话对象(如 HR)" class="plat" />
                <select v-model="chatForm.position_id">
                  <option :value="null">不关联岗位</option>
                  <option v-for="p in detail.positions" :key="p.id" :value="p.id">
                    岗位：{{ p.title }}
                  </option>
                </select>
                <button class="icon-btn scan" title="OCR 识别聊天截图" :disabled="ocrBusy" @click="ocrInput?.click()">
                  <Loader2 v-if="ocrBusy" :size="17" class="spin" />
                  <ScanText v-else :size="17" />
                </button>
                <input ref="ocrInput" type="file" accept="image/*" style="display: none" @change="onOcrChat" />
              </div>
              <div class="chat-edit">
                <textarea v-model="chatForm.content" rows="2" placeholder="录入对话内容（Ctrl+Enter 发送）" @keydown.ctrl.enter="addChat" />
                <button class="btn-primary" @click="addChat"><Send :size="14" /> 发送</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* ========== 骨架屏 ========== */
.skeleton-page {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.skeleton-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-1);
}

.skeleton-circle {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--color-border);
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--color-border) 25%, var(--color-bg) 50%, var(--color-border) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

.skeleton-block {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.w-60 { width: 60%; }
.w-40 { width: 40%; }
.w-30 { width: 30%; }
.w-80 { width: 80%; }
.w-50 { width: 50%; }
.w-70 { width: 70%; }
.w-45 { width: 45%; }
.w-35 { width: 35%; }
.w-75 { width: 75%; }
.w-55 { width: 55%; }

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ========== 页面布局 ========== */
.page {
  max-width: 1180px;
  margin: 0 auto;
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-4);
}

.head-info {
  flex: 1;
}

.head-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.head-top h2 {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 不再沟通按钮激活态 */
.no-contact-active {
  background: var(--color-danger-weak) !important;
  color: var(--color-danger) !important;
  border-color: transparent !important;
}

/* head-actions 内的按钮统一过渡 */
.head-actions .btn-soft,
.head-actions .icon-btn {
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast), opacity var(--transition-fast);
}

/* ---------- AI 评估 ---------- */
.ai-box {
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  border-left: 3px solid var(--color-primary);
  background: linear-gradient(135deg, #fafbff, #f8f6ff);
}

.ai-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-primary);
  font-weight: var(--weight-semibold);
  margin-bottom: var(--space-1);
  font-size: var(--text-sm);
}

.ai-summary {
  font-size: var(--text-md);
  margin-bottom: var(--space-1);
  line-height: var(--leading-normal);
}

.ai-detail {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  white-space: pre-wrap;
}

/* ---------- 双栏布局 ---------- */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  align-items: start;
}

.col {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.block {
  padding: var(--space-4);
  position: relative;
}

.block::before {
  content: '';
  position: absolute;
  top: 12px;
  left: -1px;
  width: 3px;
  height: 20px;
  border-radius: 2px;
  background: var(--color-primary);
  opacity: 0.4;
  transition: opacity var(--transition-fast);
}

.block:hover::before {
  opacity: 0.8;
}

.block h4 {
  font-size: var(--text-base);
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-2);
  font-weight: var(--weight-semibold);
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.block-head h4 {
  margin-bottom: 0;
}

.head-tools {
  display: flex;
  gap: 4px;
}

/* ---------- 导入框 ---------- */
.import-box {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fafbff;
}

.import-row {
  display: flex;
  gap: 8px;
}

.import-row input {
  flex: 1;
}

.import-alt a {
  font-size: var(--text-sm);
  cursor: pointer;
}

.import-raw {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-divider {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-align: center;
  position: relative;
  padding: 4px 0;
}

.import-divider::before,
.import-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 36%;
  height: 1px;
  background: var(--color-border);
}

.import-divider::before { left: 0; }
.import-divider::after { right: 0; }

.hint {
  font-size: var(--text-sm);
}

/* ---------- 终端日志 ---------- */
.term {
  background: #14181f;
  color: #b9e0a5;
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  max-height: 180px;
  overflow-y: auto;
  font-size: var(--text-sm);
}

.term pre {
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
}

/* ---------- 工商信息 ---------- */
.biz-block {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  background: #fbfcff;
}

.biz-title {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-primary);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  margin-bottom: 6px;
}

.biz-block pre {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text-primary);
  line-height: var(--leading-relaxed);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------- 基本信息键值 ---------- */
.kv {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 8px 10px;
  font-size: var(--text-base);
}

.kv dt {
  color: var(--color-text-secondary);
}

.kv dd {
  word-break: break-word;
  line-height: var(--leading-normal);
}

.kv dd svg {
  vertical-align: -2px;
}

/* ---------- 标签 ---------- */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--space-2);
}

.chip-x {
  display: inline-flex;
  color: inherit;
  opacity: 0.7;
  transition: opacity var(--transition-fast);
}

.chip-x:hover {
  opacity: 1;
}

.tag-add {
  display: flex;
  gap: 8px;
}

.tag-add input {
  flex: 1;
}

.preset {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: var(--space-2);
}

.chip-btn {
  font-size: var(--text-sm);
  padding: 3px 10px;
  border-radius: var(--radius-full);
  transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast);
}

.chip-btn:hover {
  transform: translateY(-1px);
}

/* ---------- 岗位表单 ---------- */
.pos-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: var(--space-3);
  margin: var(--space-2) 0;
  border: 1px solid var(--color-primary-soft);
  border-radius: var(--radius-lg);
  background: #fafbff;
}

.pos-salary {
  display: flex;
  gap: 8px;
}

.pos-salary input,
.pos-salary select {
  flex: 1;
}

.pos-list {
  list-style: none;
  margin-top: var(--space-2);
}

.pos-item {
  position: relative;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
  transition: border-color var(--transition-fast);
}

.pos-item:hover {
  border-color: var(--color-primary-weak);
}

.pos-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.salary {
  color: var(--color-success);
  font-weight: var(--weight-semibold);
}

.pos-sub {
  margin-top: 6px;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pos-item .actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
}

.foot-actions {
  display: flex;
  gap: 8px;
}

/* ---------- 投递记录 ---------- */
.app-list {
  list-style: none;
  margin-bottom: var(--space-2);
}

.app-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: var(--text-base);
  border-bottom: 1px dashed var(--color-border);
  transition: background var(--transition-fast);
}

.app-list li:last-child {
  border-bottom: none;
}

.app-list li:hover {
  background: var(--color-bg);
  margin: 0 -6px;
  padding: 8px 6px;
  border-radius: var(--radius-sm);
}

.app-date {
  font-weight: var(--weight-semibold);
}

.app-add {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.app-add input {
  flex: 1;
  min-width: 90px;
}

/* ---------- 对话聊天 ---------- */
.chat-block .block-head {
  margin-bottom: var(--space-2);
}

.chat-log {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  padding: var(--space-1);
}

.chat-msg {
  display: flex;
  gap: 6px;
  align-items: flex-end;
}

.chat-msg.mine {
  flex-direction: row-reverse;
}

.bubble {
  max-width: 80%;
  background: var(--color-bg);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.chat-msg.theirs .bubble {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}

.chat-msg.mine .bubble {
  background: var(--color-primary);
  color: #fff;
}

.chat-msg.mine .head-meta {
  color: rgba(255, 255, 255, 0.75);
}

.head-meta {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  margin-bottom: 2px;
}

.head-meta em {
  font-style: normal;
  margin-left: 6px;
}

.chat-input {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.chat-tools select,
.chat-tools .plat {
  width: 120px;
}

.chat-edit {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.chat-edit textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
}

.chat-edit .btn-primary {
  flex-shrink: 0;
  align-self: flex-end;
}

.scan {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.scan:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-weak);
}

.empty.small-btn {
  padding: var(--space-6) var(--space-3);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-tertiary);
}

@media (max-width: 960px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>