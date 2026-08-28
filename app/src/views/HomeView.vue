<script setup lang="ts">
// 公司列表主页：搜索 / OCR / 筛选 / 排序 / 分组 / 卡片+列表双视图 / 批量操作 / 键盘导航 / 右键菜单
import { computed, nextTick, onActivated, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search, X, ScanText, Building2, Trash2, Pencil, Loader2, Tags,
  GitCommitHorizontal, Lightbulb, Plus, ArrowUp, ArrowDown, ListFilter, FolderTree, Ban,
  Send, Sparkles, TrendingUp, LayoutGrid, Rows, CheckSquare, Square, ChevronDown,
} from '@lucide/vue'
import { useCompanyStore, type GroupKey, type SortKey, type StatusFilter } from '../stores/company'
import { api } from '../api'
import { ocrImage } from '../ocr'
import { confirm, toast } from '../ui'
import { PRESET_TAGS, type Company } from '../types'

const router = useRouter()
const store = useCompanyStore()

const ocrInput = ref<HTMLInputElement | null>(null)
const ocrBusy = ref(false)
const searchText = ref('')

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: '最近更新' },
  { key: 'score', label: 'AI 评分' },
  { key: 'risk', label: '风险等级' },
  { key: 'name', label: '名称' },
]
const GROUP_OPTIONS: { key: GroupKey; label: string }[] = [
  { key: 'none', label: '不分组' },
  { key: 'risk', label: '按风险' },
  { key: 'status', label: '按状态' },
]
const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '沟通中' },
  { key: 'closed', label: '不再沟通' },
]

// 使用引导：仅在尚无任何收录且未手动关闭时显示
const guideDismissed = ref(localStorage.getItem('guide-dismissed') === '1')
const showGuide = computed(() => store.stats.company_count === 0 && !guideDismissed.value)
function dismissGuide() {
  guideDismissed.value = true
  localStorage.setItem('guide-dismissed', '1')
}

// 搜索：输入防抖 300ms，回车立即生效
let searchTimer: number | undefined
function onSearchInput() {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => store.setKeyword(searchText.value), 300)
}
async function onSearch() {
  window.clearTimeout(searchTimer)
  await store.setKeyword(searchText.value)
}
function clearSearch() {
  window.clearTimeout(searchTimer)
  searchText.value = ''
  store.setKeyword('')
}

// OCR 识别图片并将其作为关键词填入搜索框
async function onOcrFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  ocrBusy.value = true
  try {
    const text = await ocrImage(file)
    searchText.value = text.replace(/\s+/g, ' ').slice(0, 60)
    await store.setKeyword(searchText.value)
  } catch (err) {
    toast(`OCR 识别失败：${err}`, 'error')
  } finally {
    ocrBusy.value = false
    if (ocrInput.value) ocrInput.value.value = ''
  }
}

// 状态计数：随当前搜索词变化
function statusCount(s: StatusFilter): number {
  if (s === 'active') return store.companies.filter((c) => !c.no_contact).length
  if (s === 'closed') return store.companies.filter((c) => c.no_contact).length
  return store.companies.length
}

// 标签筛选入口：预置标签优先（按预置顺序），其次自定义标签，始终包含已选标签
const filterTags = computed(() => {
  const used = new Set(store.tagStats.map((t) => t.tag))
  const preset = PRESET_TAGS.filter((t) => used.has(t))
  const custom = store.tagStats.filter((t) => !PRESET_TAGS.includes(t.tag)).map((t) => t.tag)
  const extra = store.activeTags.filter((t) => !used.has(t))
  return [...preset, ...custom, ...extra]
})

// 标签折叠：标签过多时默认收起，避免占用大量垂直空间
const MAX_TAGS = 8
const tagsExpanded = ref(false)
const visibleTags = computed(() =>
  tagsExpanded.value ? filterTags.value : filterTags.value.slice(0, MAX_TAGS),
)
const hasMoreTags = computed(() => filterTags.value.length > MAX_TAGS)

// 按得分换算颜色
function scoreClass(c: Company): string {
  const s = c.ai_score ?? -1
  if (s < 0) return 'var(--color-border)'
  if (s >= 80) return 'var(--color-success)'
  if (s >= 60) return 'var(--color-primary)'
  if (s >= 40) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function scoreText(c: Company): string {
  return c.ai_score == null ? '未评分' : String(c.ai_score)
}

// 分组圆点的样式 key
const RISK_DOT: Record<string, string> = { 极高: 'd-r4', 高: 'd-r3', 中: 'd-r2', 低: 'd-r1', 未标注风险: 'd-r0' }
function dotClass(key: string): string {
  if (key === 'active') return 'd-active'
  if (key === 'closed') return 'd-closed'
  return RISK_DOT[key] ?? 'd-r0'
}

// 相对时间显示
function fmtRelative(ts: number): string {
  const diff = Date.now() / 1000 - ts
  const day = 86400
  if (diff < 3600) return '刚刚'
  if (diff < day) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ts * 1000)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// 全局序号（按当前排序）
function rankOf(c: Company): number {
  return store.sorted.indexOf(c) + 1
}

// 按沟通状态拆分
const closedList = computed(() => store.sorted.filter((c) => c.no_contact))

// ================= 视图模式（卡片 / 列表） =================
type ViewMode = 'card' | 'list'
const viewMode = ref<ViewMode>((localStorage.getItem('home-view-mode') as ViewMode) || 'card')
function setViewMode(m: ViewMode) {
  viewMode.value = m
  localStorage.setItem('home-view-mode', m)
}

// ================= 批量选择 =================
const selecting = ref(false)
const selected = ref<Set<number>>(new Set())
function toggleSelect(id: number) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
function isSelected(id: number): boolean {
  return selected.value.has(id)
}
function enterSelect() {
  selecting.value = true
  focusIndex.value = -1
}
function exitSelect() {
  selecting.value = false
  selected.value.clear()
}

// 批量标记为不再沟通
async function batchNoContact() {
  const list = store.companies.filter((c) => selected.value.has(c.id) && !c.no_contact)
  if (!list.length) {
    toast('所选公司均已标记为「不再沟通」', 'info')
    return
  }
  if (await confirm(`将 ${list.length} 家公司标记为「不再沟通」？`)) {
    for (const c of list) await api.updateCompany(c.id, { name: c.name, no_contact: true })
    toast(`已标记 ${list.length} 家`, 'success')
    exitSelect()
    await store.refresh()
  }
}

// 批量删除
async function batchDelete() {
  const n = selected.value.size
  if (!n) return
  if (await confirm(`删除所选 ${n} 家公司及其全部关联数据？此操作不可恢复。`)) {
    for (const id of selected.value) await api.deleteCompany(id)
    toast(`已删除 ${n} 家`, 'success')
    exitSelect()
    await store.refresh()
  }
}

// ================= 键盘快速导航 =================
const focusIndex = ref(-1)
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}
function ensureFocusVisible() {
  nextTick(() => {
    document
      .querySelector(`[data-focus-idx="${focusIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}
function onKeydown(e: KeyboardEvent) {
  if (isTypingTarget(e.target)) return
  const list = store.sorted
  if (!list.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusIndex.value = (focusIndex.value + 1) % list.length
    ensureFocusVisible()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusIndex.value = (focusIndex.value - 1 + list.length) % list.length
    ensureFocusVisible()
  } else if (e.key === 'Enter' && focusIndex.value >= 0) {
    e.preventDefault()
    router.push(`/company/${list[focusIndex.value].id}`)
  } else if (
    (e.key === 'Delete' || e.key === 'Backspace') &&
    focusIndex.value >= 0 &&
    !selecting.value
  ) {
    e.preventDefault()
    onDelete(list[focusIndex.value])
  } else if (e.key === 'Escape') {
    if (ctx.show) closeCtx()
    else if (selecting.value) exitSelect()
    focusIndex.value = -1
  }
}

// ================= 右键快捷菜单 =================
const ctx = reactive({ show: false, x: 0, y: 0, c: null as Company | null })
let ctxOpenedAt = 0
function openCtx(e: MouseEvent, c: Company) {
  e.preventDefault()
  e.stopPropagation()
  ctxOpenedAt = Date.now()
  ctx.show = true
  ctx.x = Math.min(e.clientX, window.innerWidth - 176)
  ctx.y = Math.min(e.clientY, window.innerHeight - 180)
  ctx.c = c
}
function closeCtx() {
  ctx.show = false
  ctx.c = null
}
// 点击菜单外关闭（右键刚打开时忽略一次 click）
function onDocClick() {
  if (Date.now() - ctxOpenedAt < 120) return
  closeCtx()
}

// 菜单动作
function ctxGo() {
  if (!ctx.c) return
  const id = ctx.c.id
  closeCtx()
  router.push(`/company/${id}`)
}
function ctxEdit() {
  if (!ctx.c) return
  const id = ctx.c.id
  closeCtx()
  router.push(`/company/${id}/edit`)
}
function ctxToggleNoContact() {
  const c = ctx.c
  closeCtx()
  if (c) toggleNoContactFromCard(c)
}
function ctxDelete() {
  const c = ctx.c
  closeCtx()
  if (c) onDelete(c)
}

// ================= 单条操作 =================
async function onDelete(c: Company) {
  if (await confirm(`删除「${c.name}」及其全部关联数据？此操作不可恢复。`)) {
    await store.removeCompany(c.id)
    toast('已删除', 'success')
  }
}
async function toggleNoContactFromCard(c: Company) {
  await api.updateCompany(c.id, { name: c.name, no_contact: !c.no_contact })
  toast(c.no_contact ? '已恢复沟通' : '已标记为不再沟通', 'info')
  await store.refresh()
}

onMounted(() => {
  searchText.value = ''
  store.clearFilters()
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
})
onActivated(() => {
  searchText.value = ''
  store.clearFilters()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="page">
    <div class="home-layout">
      <div class="home-main">
        <!-- 使用引导（仅首次使用） -->
        <div v-if="showGuide" class="card guide">
          <div class="guide-icon-wrap"><Lightbulb :size="18" /></div>
          <div class="guide-body">
            <strong>快速开始</strong>
            <div class="guide-steps">
              <div class="step"><b>1</b><span>点右上角「＋」收录一家应聘公司，填写简介与人工风险备注</span></div>
              <div class="step"><b>2</b><span>进入详情：添加<em>岗位</em>（薪资/HR）→ 录入或 OCR 截图<em>沟通对话</em> → 记录<em>投递</em></span></div>
              <div class="step"><b>3</b><span>打标签（甲方/乙方/外包/避雷…），支持多选筛选、排序与分组</span></div>
              <div class="step"><b>4</b><span>「设置」填入 DeepSeek Key 后点「AI 评分」获取综合分与结论</span></div>
            </div>
          </div>
          <button class="icon-btn" title="关闭提示" aria-label="关闭提示" @click="dismissGuide"><X :size="16" /></button>
        </div>

        <!-- 搜索区 -->
        <div class="search-row">
          <div class="search-box">
            <Search :size="17" class="search-icon" />
            <input
              v-model="searchText"
              placeholder="按公司名 / 行业 / 简介模糊搜索…（/ 聚焦）"
              @input="onSearchInput"
              @keyup.enter="onSearch"
            />
            <button v-if="searchText" class="icon-btn" title="清空" @click="clearSearch">
              <X :size="16" />
            </button>
          </div>
          <button class="icon-btn scan" title="OCR 识别图片并搜索" :disabled="ocrBusy" @click="ocrInput?.click()">
            <Loader2 v-if="ocrBusy" :size="18" class="spin" />
            <ScanText v-else :size="18" />
          </button>
          <input ref="ocrInput" type="file" accept="image/*" style="display: none" @change="onOcrFile" />
        </div>

        <!-- 统计（紧凑横排） -->
        <div class="stats-strip">
          <div class="stat-item" title="已收录公司数">
            <span class="stat-icon"><Building2 :size="14" /></span>
            <b class="stat-num">{{ store.stats.company_count }}</b>
            <span class="stat-label">家收录</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item" title="累计投递次数">
            <span class="stat-icon"><Send :size="14" /></span>
            <b class="stat-num">{{ store.stats.apply_count }}</b>
            <span class="stat-label">次投递</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item" title="已 AI 评分公司数">
            <span class="stat-icon"><Sparkles :size="14" /></span>
            <b class="stat-num">{{ store.stats.scored_count }}</b>
            <span class="stat-label">家已评分</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item" v-if="store.stats.avg_score != null" title="平均 AI 评分">
            <span class="stat-icon"><TrendingUp :size="14" /></span>
            <b class="stat-num">{{ store.stats.avg_score }}</b>
            <span class="stat-label">平均分</span>
          </div>
        </div>

        <!-- 吸顶工具条：状态筛选 + 排序/分组 + 视图切换 + 多选 -->
        <div class="toolbar-sticky">
          <div class="status-seg" role="group" aria-label="沟通状态筛选">
            <button
              v-for="s in STATUS_OPTIONS"
              :key="s.key"
              class="status-btn"
              :class="{ active: store.statusFilter === s.key }"
              :aria-pressed="store.statusFilter === s.key"
              @click="store.toggleStatus(s.key)"
            >
              {{ s.label }}<b class="count">{{ statusCount(s.key) }}</b>
            </button>
          </div>
          <span class="toolbar-spacer"></span>
          <div class="toolbar-right">
            <div class="tool">
              <ListFilter :size="14" class="tool-icon" />
              <div class="seg" role="group" aria-label="排序方式">
                <button
                  v-for="o in SORT_OPTIONS"
                  :key="o.key"
                  :class="{ active: store.sortBy === o.key }"
                  :title="`按${o.label}排序`"
                  @click="store.setSortBy(o.key)"
                >{{ o.label }}</button>
              </div>
              <button
                class="icon-btn dir-btn"
                :title="store.sortDir === 'desc' ? '切换为升序' : '切换为降序'"
                @click="store.setSortBy(store.sortBy)"
              >
                <ArrowDown v-if="store.sortDir === 'desc'" :size="14" />
                <ArrowUp v-else :size="14" />
              </button>
            </div>
            <div class="tool group-tool">
              <FolderTree :size="14" class="tool-icon" />
              <div class="seg" role="group" aria-label="分组方式">
                <button
                  v-for="g in GROUP_OPTIONS"
                  :key="g.key"
                  :class="{ active: store.groupBy === g.key }"
                  @click="store.setGroupBy(g.key)"
                >{{ g.label }}</button>
              </div>
            </div>
            <div class="view-tools">
              <button
                class="icon-btn"
                :class="{ active: viewMode === 'card' }"
                title="卡片视图"
                aria-label="切换为卡片视图"
                @click="setViewMode('card')"
              ><LayoutGrid :size="16" /></button>
              <button
                class="icon-btn"
                :class="{ active: viewMode === 'list' }"
                title="列表视图（紧凑，适合大量公司）"
                aria-label="切换为列表视图"
                @click="setViewMode('list')"
              ><Rows :size="16" /></button>
              <button
                class="icon-btn"
                :class="{ active: selecting }"
                :title="selecting ? '退出多选' : '多选批量操作'"
                aria-label="多选批量操作"
                @click="selecting ? exitSelect() : enterSelect()"
              ><CheckSquare :size="16" /></button>
            </div>
            <span class="result-count">共 <b>{{ store.sorted.length }}</b> 家</span>
          </div>
        </div>

        <!-- 标签筛选（可折叠） -->
        <div v-if="visibleTags.length || store.hasFilters" class="tag-row">
          <div class="tag-filters">
            <button
              v-for="t in visibleTags"
              :key="t"
              class="tag-filter"
              :class="{ active: store.activeTags.includes(t) }"
              :aria-pressed="store.activeTags.includes(t)"
              :title="`按「${t}」筛选，可多选`"
              @click="store.toggleTag(t)"
            >
              {{ t }}<b class="count">{{ store.tagCount(t) }}</b>
            </button>
            <button
              v-if="hasMoreTags"
              class="tag-filter more"
              :title="tagsExpanded ? '收起标签' : '展开全部标签'"
              @click="tagsExpanded = !tagsExpanded"
            >
              {{ tagsExpanded ? '收起' : `+${filterTags.length - MAX_TAGS}` }}<ChevronDown :size="12" :class="{ flip: tagsExpanded }" />
            </button>
          </div>
          <button v-if="store.hasFilters" class="btn-soft clear-btn" @click="store.clearFilters()">
            <X :size="13" /> 清除筛选
          </button>
        </div>

        <!-- 错误 / 加载 / 列表 -->
        <div v-if="store.error" class="card error-bar">
          <span>{{ store.error }}</span>
          <button class="btn-soft" @click="store.clearFilters()">重试</button>
        </div>
        <div v-if="store.loading" class="grid">
          <div v-for="i in 6" :key="i" class="card skeleton-card">
            <div class="sk-row">
              <div class="sk-rect sk-rank"></div>
              <div class="sk-rect sk-title"></div>
              <div class="sk-rect sk-score"></div>
            </div>
            <div class="sk-rect sk-meta"></div>
            <div class="sk-row sk-chips">
              <div class="sk-rect sk-chip"></div>
              <div class="sk-rect sk-chip"></div>
              <div class="sk-rect sk-chip"></div>
            </div>
            <div class="sk-row sk-foot">
              <div class="sk-rect sk-time"></div>
              <div class="sk-actions">
                <div class="sk-rect sk-icon"></div>
                <div class="sk-rect sk-icon"></div>
              </div>
            </div>
          </div>
        </div>
        <template v-else-if="store.sorted.length">
          <section v-for="g in store.groups" :key="g.key" class="group">
            <h4 v-if="store.groups.length > 1" class="group-head">
              <span class="dot" :class="dotClass(g.key)"></span>
              {{ g.label }}<b>{{ g.count }}</b>
            </h4>

            <!-- 卡片视图 -->
            <div v-if="viewMode === 'card'" class="grid">
              <article
                v-for="c in g.items"
                :key="c.id"
                class="card company"
                :class="{
                  'no-contact': c.no_contact,
                  'has-score': c.ai_score != null,
                  'selected': isSelected(c.id),
                  'focus-ring': focusIndex === rankOf(c) - 1,
                }"
                :data-focus-idx="rankOf(c) - 1"
                :title="selecting ? '点击切换选择' : '点击查看详情（右键更多操作）'"
                @click="selecting ? toggleSelect(c.id) : router.push(`/company/${c.id}`)"
                @contextmenu="openCtx($event, c)"
              >
                <span
                  class="score-stripe"
                  :style="c.ai_score != null ? { background: scoreClass(c) } : {}"
                ></span>
                <!-- 多选模式勾选框 -->
                <span v-if="selecting" class="select-box" @click.stop="toggleSelect(c.id)">
                  <Square v-if="!isSelected(c.id)" :size="16" />
                  <CheckSquare v-else :size="16" />
                </span>
                <div class="row">
                  <div class="rank">{{ rankOf(c) }}</div>
                  <h3 :title="c.name">{{ c.name }}</h3>
                  <span v-if="c.no_contact" class="no-contact-badge" title="已不再沟通">不再沟通</span>
                  <span
                    class="score-badge"
                    :class="{ unscored: c.ai_score == null }"
                    :style="c.ai_score != null ? { background: scoreClass(c) } : {}"
                  >{{ scoreText(c) }}</span>
                </div>

                <div class="meta">
                  <span v-if="c.industry" class="meta-industry"><Building2 :size="13" /> {{ c.industry }}</span>
                  <span v-if="c.risk_level" class="risk-chip" :class="`r-${c.risk_level}`">
                    <Tags :size="12" /> 风险{{ c.risk_level }}
                  </span>
                </div>

                <div class="chip-line">
                  <span v-for="t in c.tags" :key="t" class="tag-chip" :class="{ 'read-no-reply': t === '已读不回' }">{{ t }}</span>
                  <span v-if="c.risk_note" class="tag-chip note-chip" :title="c.risk_note">{{ c.risk_note }}</span>
                  <span v-if="c.ai_summary && c.ai_summary !== c.risk_note" class="tag-chip ai-chip" :title="c.ai_summary">{{ c.ai_summary }}</span>
                </div>

                <footer class="foot">
                  <span class="muted"><GitCommitHorizontal :size="13" /> {{ fmtRelative(c.updated_at) }}</span>
                  <span class="actions" @click.stop>
                    <button class="icon-btn" title="编辑" aria-label="编辑公司" @click="router.push(`/company/${c.id}/edit`)">
                      <Pencil :size="16" />
                    </button>
                    <button class="icon-btn danger" title="删除" aria-label="删除公司" @click="onDelete(c)">
                      <Trash2 :size="16" />
                    </button>
                  </span>
                </footer>
              </article>
            </div>

            <!-- 列表视图（紧凑表格） -->
            <div v-else class="list-view">
              <div
                v-for="c in g.items"
                :key="c.id"
                class="list-row"
                :class="{
                  'no-contact': c.no_contact,
                  'selected': isSelected(c.id),
                  'focus-ring': focusIndex === rankOf(c) - 1,
                }"
                :data-focus-idx="rankOf(c) - 1"
                @click="selecting ? toggleSelect(c.id) : router.push(`/company/${c.id}`)"
                @contextmenu="openCtx($event, c)"
              >
                <span v-if="selecting" class="list-check" @click.stop="toggleSelect(c.id)">
                  <Square v-if="!isSelected(c.id)" :size="15" />
                  <CheckSquare v-else :size="15" />
                </span>
                <span class="list-rank">{{ rankOf(c) }}</span>
                <div class="list-name">
                  <strong>{{ c.name }}</strong>
                  <span v-if="c.industry" class="muted">{{ c.industry }}</span>
                </div>
                <span
                  class="score-badge"
                  :class="{ unscored: c.ai_score == null }"
                  :style="c.ai_score != null ? { background: scoreClass(c) } : {}"
                >{{ scoreText(c) }}</span>
                <span v-if="c.risk_level" class="risk-chip list-risk" :class="`r-${c.risk_level}`">
                  风险{{ c.risk_level }}
                </span>
                <div class="list-tags">
                  <span v-for="t in c.tags.slice(0, 3)" :key="t" class="tag-chip" :class="{ 'read-no-reply': t === '已读不回' }">{{ t }}</span>
                  <span v-if="c.no_contact" class="no-contact-badge">不再沟通</span>
                </div>
                <span class="list-time muted"><GitCommitHorizontal :size="12" /> {{ fmtRelative(c.updated_at) }}</span>
                <span class="list-actions" @click.stop>
                  <button class="icon-btn" title="编辑" aria-label="编辑公司" @click="router.push(`/company/${c.id}/edit`)">
                    <Pencil :size="15" />
                  </button>
                  <button class="icon-btn danger" title="删除" aria-label="删除公司" @click="onDelete(c)">
                    <Trash2 :size="15" />
                  </button>
                </span>
              </div>
            </div>
          </section>
        </template>

        <!-- 空状态 -->
        <div v-else class="empty">
          <svg class="empty-illustration" width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="16" width="48" height="40" rx="8" fill="var(--color-primary-weak)" stroke="var(--color-primary-soft)" stroke-width="2"/>
            <path d="M24 28h16M24 36h16M24 44h10" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round" stroke-opacity="0.5"/>
            <circle cx="48" cy="20" r="10" fill="var(--color-primary)" opacity="0.12"/>
            <path d="M44 20h8M48 16v8" stroke="var(--color-primary)" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>
            <template v-if="store.hasFilters">当前筛选下暂无公司，<a @click.prevent="store.clearFilters()">清除筛选</a>重新查看。</template>
            <template v-else>还没有收录公司，从第一家开始记录吧</template>
          </p>
          <div class="empty-actions">
            <button v-if="!store.hasFilters" class="btn-primary" @click="router.push('/company/new')">
              <Plus :size="15" /> 收录新公司
            </button>
            <button v-else class="btn-soft" @click="store.clearFilters()">清除筛选</button>
          </div>
        </div>
      </div>

      <!-- 右侧竖列表：不再沟通 -->
      <aside v-if="closedList.length" class="home-sidebar">
        <div class="card closed-list">
          <div class="closed-head">
            <Ban :size="14" /> 不再沟通 <em>({{ closedList.length }})</em>
          </div>
          <div class="closed-names">
            <a
              v-for="c in closedList"
              :key="c.id"
              class="closed-name"
              @click="router.push(`/company/${c.id}`)"
            >{{ c.name }}</a>
          </div>
        </div>
      </aside>
    </div>

    <!-- 批量操作栏（多选模式，底部吸底） -->
    <Transition name="fade">
      <div v-if="selecting" class="batch-bar" role="toolbar" aria-label="批量操作">
        <span class="batch-count">已选 <b>{{ selected.size }}</b> 家</span>
        <button class="btn-soft" :disabled="!selected.size" @click="batchNoContact">
          <Ban :size="14" /> 标记不再沟通
        </button>
        <button class="btn-soft danger-soft" :disabled="!selected.size" @click="batchDelete">
          <Trash2 :size="14" /> 删除
        </button>
        <button class="icon-btn" title="退出多选 (Esc)" aria-label="退出多选" @click="exitSelect">
          <X :size="16" />
        </button>
      </div>
    </Transition>

    <!-- 右键快捷菜单 -->
    <Teleport to="body">
      <div
        v-if="ctx.show"
        class="ctx-menu"
        role="menu"
        :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
        @click.stop
      >
        <button role="menuitem" @click="ctxGo"><Building2 :size="14" /> 打开详情</button>
        <button role="menuitem" @click="ctxEdit"><Pencil :size="14" /> 编辑</button>
        <button role="menuitem" @click="ctxToggleNoContact">
          <Ban :size="14" /> {{ ctx.c?.no_contact ? '恢复沟通' : '不再沟通' }}
        </button>
        <div class="ctx-divider"></div>
        <button role="menuitem" class="danger" @click="ctxDelete"><Trash2 :size="14" /> 删除</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  max-width: 1120px;
  margin: 0 auto;
}

.home-layout {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.home-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.home-sidebar {
  width: 200px;
  flex-shrink: 0;
  position: sticky;
  top: 12px;
}

@media (max-width: 900px) {
  .home-layout {
    flex-direction: column;
  }
  .home-sidebar {
    width: 100%;
    position: static;
  }
}

/* ---------- 使用引导 ---------- */
.guide {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: var(--space-4);
  background: linear-gradient(135deg, #f0f4ff, #faf6ff);
  border-left: 3px solid var(--color-primary);
}

.guide-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
  flex-shrink: 0;
}

.guide-body {
  flex: 1;
}

.guide-body strong {
  display: block;
  margin-bottom: 8px;
  font-size: var(--text-md);
}

.guide-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
}

.step b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  flex-shrink: 0;
  margin-top: 2px;
}

.step em {
  color: var(--color-primary);
  font-style: normal;
}

/* ---------- 搜索 ---------- */
.search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 0 6px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-box:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-weak);
}

.search-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  border: none;
  background: transparent;
  padding: 6px 0;
}

.search-box input:focus {
  box-shadow: none;
}

.scan {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

/* ---------- 统计（紧凑横排） ---------- */
.stats-strip {
  display: flex;
  align-items: stretch;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.stat-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px var(--space-3);
  min-width: 0;
  transition: background var(--transition-fast);
}

.stat-item:hover {
  background: var(--color-primary-weak);
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--color-primary-weak);
  color: var(--color-primary);
  flex-shrink: 0;
}

.stat-num {
  font-size: var(--text-md);
  font-weight: var(--weight-bold);
  color: var(--color-primary);
  line-height: 1;
}

.stat-label {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.stat-divider {
  width: 1px;
  background: var(--color-border);
  flex-shrink: 0;
}

/* ---------- 吸顶工具条 ---------- */
.toolbar-sticky {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 6px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  position: sticky;
  top: 0;
  z-index: 20;
  box-shadow: var(--shadow-sm);
}

.status-seg {
  display: inline-flex;
  gap: 4px;
}

.status-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 3px 10px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  transition: all var(--transition-fast);
}

.status-btn .count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-secondary);
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 1px 6px;
}

.status-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: var(--weight-semibold);
}

.status-btn.active .count {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}

.status-btn:hover:not(.active) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.tool {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-icon {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.seg {
  display: inline-flex;
  background: var(--color-bg);
  border-radius: 7px;
  padding: 2px;
  gap: 2px;
}

.seg button {
  padding: 3px 9px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.seg button:hover:not(.active) {
  color: var(--color-primary);
}

.seg button.active {
  background: var(--color-surface);
  color: var(--color-primary);
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-sm);
}

.dir-btn {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
}

.view-tools {
  display: flex;
  gap: 2px;
  border-left: 1px solid var(--color-border);
  padding-left: 8px;
}

.result-count {
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.result-count b {
  color: var(--color-text-primary);
}

/* ---------- 标签筛选行 ---------- */
.tag-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.tag-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.tag-filter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 2px 9px;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  transition: all var(--transition-fast);
}

.tag-filter .count {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-secondary);
}

.tag-filter:hover:not(.active) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.tag-filter.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: var(--weight-semibold);
}

.tag-filter.active .count {
  color: #fff;
}

.tag-filter.more {
  border-style: dashed;
  color: var(--color-text-secondary);
}

.tag-filter.more svg {
  transition: transform var(--transition-fast);
}

.tag-filter.more svg.flip {
  transform: rotate(180deg);
}

.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* ---------- 错误 / 空状态 ---------- */
.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: var(--space-2) var(--space-4);
  border-left: 3px solid var(--color-danger);
  color: var(--color-danger);
  font-size: var(--text-base);
  word-break: break-all;
}

.empty-illustration {
  display: block;
  margin: 0 auto var(--space-3);
  opacity: 0.85;
}

.empty-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* ---------- 分组 ---------- */
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-text-secondary);
  margin: var(--space-1) var(--space-1) 0;
}

.group-head b {
  background: var(--color-bg);
  border-radius: var(--radius-full);
  padding: 0 6px;
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-secondary);
}

.group-head .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot {
  background: var(--color-border);
}

.d-r4 { background: #8b1e1e; }
.d-r3 { background: var(--color-danger); }
.d-r2 { background: var(--color-warning); }
.d-r1 { background: var(--color-success); }
.d-r0 { background: var(--color-border); }
.d-active { background: var(--color-primary); }
.d-closed { background: var(--color-text-tertiary); }

/* 不再沟通公司名称词条列表（右侧竖列表） */
.closed-list {
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--color-text-tertiary);
}

.closed-head {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 5px;
}

.closed-head em {
  font-style: normal;
  font-weight: var(--weight-normal);
  color: var(--color-text-secondary);
}

.closed-names {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.closed-name {
  display: block;
  padding: 5px 8px;
  border-radius: 5px;
  font-size: var(--text-base);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.closed-name:hover {
  background: var(--color-primary-weak);
  color: var(--color-primary);
}

/* ---------- 公司卡片（卡片视图） ---------- */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.company {
  padding: var(--space-4);
  cursor: pointer;
  position: relative;
  transition: transform var(--transition-base), border-color var(--transition-fast),
    box-shadow var(--transition-base);
}

.company:hover {
  transform: translateY(-2px);
  border-color: var(--color-primary-soft);
  box-shadow: var(--shadow-lg);
}

.score-stripe {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--color-border);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.company:hover .score-stripe {
  opacity: 1;
}

/* 多选模式勾选框 */
.select-box {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  transition: all var(--transition-fast);
}

.select-box:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

/* 多选选中态 */
.company.selected,
.list-row.selected {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px var(--color-primary-weak), var(--shadow-md) !important;
  transform: none !important;
}

/* 键盘导航焦点态 */
.focus-ring {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

/* 不再沟通卡片：置灰 + 虚线边框 */
.company.no-contact {
  opacity: 0.6;
  filter: grayscale(0.8);
  background: #f3f4f5;
  border: 1px dashed #a8adb5;
}

.company.no-contact .rank {
  background: #d5d8dc;
  color: #7a7f86;
}

.company.no-contact .score-badge {
  opacity: 0.75;
}

.company.no-contact:hover {
  transform: none;
  box-shadow: none;
}

.company.no-contact:hover .score-stripe {
  opacity: 0.4;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

h3 {
  flex: 1;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  align-items: center;
}

.meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* 行业名过长时省略，让出空间给风险标识，避免挤压 */
.meta-industry {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
  max-width: 70%;
}

/* 风险标识保持完整宽度，不允许被压缩或裁剪 */
.meta .risk-chip {
  flex-shrink: 0;
  min-width: max-content;
}

.chip-line {
  margin-top: var(--space-2);
  min-height: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.note-chip {
  background: var(--color-bg);
  color: var(--color-text-secondary);
  border: 1px dashed var(--color-border);
  border-left: 3px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
}

.ai-chip {
  background: var(--color-warning-weak);
  color: #b26a00;
  border-left: 3px solid var(--color-warning);
  border-radius: var(--radius-sm);
  max-width: 100%;
  overflow-wrap: anywhere;
  line-height: 1.5;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.foot .muted {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
}

/* 操作入口显性化：默认弱化，hover 浮现高对比 */
.actions {
  display: flex;
  gap: 4px;
  opacity: 0.4;
  transition: opacity var(--transition-fast);
}

.company:hover .actions,
.company .actions:focus-within {
  opacity: 1;
}

/* ---------- 列表视图（紧凑表格） ---------- */
.list-view {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.list-row:hover {
  border-color: var(--color-primary-soft);
  box-shadow: var(--shadow-md);
}

.list-row.no-contact {
  opacity: 0.6;
  filter: grayscale(0.8);
  background: #f3f4f5;
}

.list-check {
  display: flex;
  align-items: center;
  color: var(--color-text-tertiary);
  transition: color var(--transition-fast);
}

.list-check:hover {
  color: var(--color-primary);
}

.list-rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--color-primary-weak);
  color: var(--color-primary);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.list-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.list-name strong {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-name .muted {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-risk {
  flex-shrink: 0;
}

.list-tags {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
}

.list-tags .tag-chip {
  font-size: var(--text-xs);
  padding: 1px 7px;
}

.list-time {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  white-space: nowrap;
  flex-shrink: 0;
}

.list-actions {
  display: flex;
  gap: 2px;
  opacity: 0.4;
  transition: opacity var(--transition-fast);
  flex-shrink: 0;
}

.list-row:hover .list-actions,
.list-row .list-actions:focus-within {
  opacity: 1;
}

@media (max-width: 720px) {
  .list-time,
  .list-risk,
  .list-tags {
    display: none;
  }
}

/* ---------- 批量操作栏 ---------- */
.batch-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 20px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.batch-count {
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.batch-count b {
  color: var(--color-primary);
  font-size: var(--text-lg);
}

.danger-soft {
  background: var(--color-danger-weak);
  color: var(--color-danger);
}

.danger-soft:hover {
  background: var(--color-danger);
  color: #fff;
}

/* 批量栏进入过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* ---------- 右键快捷菜单 ---------- */
.ctx-menu {
  position: fixed;
  z-index: 200;
  min-width: 160px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  display: flex;
  flex-direction: column;
}

.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  color: var(--color-text-primary);
  text-align: left;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.ctx-menu button:hover {
  background: var(--color-primary-weak);
  color: var(--color-primary);
}

.ctx-menu button.danger:hover {
  background: var(--color-danger-weak);
  color: var(--color-danger);
}

.ctx-divider {
  height: 1px;
  margin: 3px 4px;
  background: var(--color-border);
}

/* ---------- 加载骨架屏 ---------- */
.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: var(--space-4);
  min-height: 148px;
}

.sk-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sk-rect {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--color-border) 25%, var(--color-bg) 50%, var(--color-border) 75%);
  background-size: 200% 100%;
  animation: sk-shimmer 1.5s ease-in-out infinite;
}

.sk-rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex-shrink: 0;
}

.sk-title {
  flex: 1;
  height: 16px;
}

.sk-score {
  width: 40px;
  height: 20px;
  border-radius: 6px;
  flex-shrink: 0;
}

.sk-meta {
  width: 55%;
}

.sk-chip {
  width: 56px;
  height: 20px;
  border-radius: var(--radius-full);
}

.sk-foot {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.sk-time {
  width: 90px;
}

.sk-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.sk-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
}

@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 900px) {
  .group-tool {
    display: none;
  }
}
</style>
