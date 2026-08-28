// 公司列表与标签的全局状态
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api'
import type { Company, Stats, TagStat } from '../types'

export type StatusFilter = 'all' | 'active' | 'closed'
export type SortKey = 'updated' | 'score' | 'risk' | 'name'
export type SortDir = 'asc' | 'desc'
export type GroupKey = 'none' | 'risk' | 'status'

export interface CompanyGroup {
  key: string
  label: string
  count: number
  items: Company[]
}

// 风险等级权重：极高 > 高 > 中 > 低 > 未标注
const RISK_ORDER: Record<string, number> = { 极高: 4, 高: 3, 中: 2, 低: 1 }

function riskRank(c: Company): number {
  return c.risk_level ? (RISK_ORDER[c.risk_level] ?? 0) : 0
}

function loadPref<T extends string>(key: string, fallback: T): T {
  const v = localStorage.getItem(key)
  return ((v as T) || fallback) as T
}

export const useCompanyStore = defineStore('company', () => {
  const companies = ref<Company[]>([])
  const tagStats = ref<TagStat[]>([])
  const stats = ref<Stats>({ company_count: 0, apply_count: 0, scored_count: 0, avg_score: null })
  const keyword = ref('')
  const statusFilter = ref<StatusFilter>('all')
  const activeTags = ref<string[]>([])
  // 排序/分组偏好持久化，回到首页时保留
  const sortBy = ref<SortKey>(loadPref('home-sort-by', 'updated'))
  const sortDir = ref<SortDir>(loadPref('home-sort-dir', 'desc'))
  const groupBy = ref<GroupKey>(loadPref('home-group-by', 'none'))
  const loading = ref(false)
  const error = ref('')

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      // 关键词由后端模糊搜索；标签/状态在前端过滤，支持多选与即时切换
      companies.value = await api.listCompanies(keyword.value, '')
      tagStats.value = await api.listTags()
      stats.value = await api.getStats()
      return true
    } catch (e) {
      console.error(e)
      error.value = String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  // 回到列表时清空筛选，避免新记录被过滤看不到（排序/分组偏好保留）
  async function clearFilters() {
    keyword.value = ''
    statusFilter.value = 'all'
    activeTags.value = []
    await refresh()
  }

  async function setKeyword(v: string) {
    keyword.value = v
    await refresh()
  }

  function toggleStatus(s: StatusFilter) {
    statusFilter.value = statusFilter.value === s ? 'all' : s
  }

  function toggleTag(t: string) {
    activeTags.value = activeTags.value.includes(t)
      ? activeTags.value.filter((x) => x !== t)
      : [...activeTags.value, t]
  }

  // 点击同一排序项时切换方向；切换排序项时给出合理默认方向
  function setSortBy(k: SortKey) {
    if (sortBy.value === k) {
      sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    } else {
      sortBy.value = k
      sortDir.value = k === 'name' ? 'asc' : 'desc'
    }
    localStorage.setItem('home-sort-by', sortBy.value)
    localStorage.setItem('home-sort-dir', sortDir.value)
  }

  function setGroupBy(g: GroupKey) {
    groupBy.value = g
    localStorage.setItem('home-group-by', g)
  }

  function tagCount(tag: string): number {
    return tagStats.value.find((t) => t.tag === tag)?.count ?? 0
  }

  const hasFilters = computed(
    () => !!keyword.value.trim() || statusFilter.value !== 'all' || activeTags.value.length > 0,
  )

  // 状态 + 标签过滤后的候选集（排序前）
  const baseList = computed(() =>
    companies.value.filter((c) => {
      if (statusFilter.value === 'active' && c.no_contact) return false
      if (statusFilter.value === 'closed' && !c.no_contact) return false
      if (activeTags.value.length && !activeTags.value.every((t) => c.tags.includes(t))) return false
      return true
    }),
  )

  const sorted = computed<Company[]>(() => {
    const dir = sortDir.value === 'desc' ? -1 : 1
    const arr = [...baseList.value]
    switch (sortBy.value) {
      case 'score':
        // 未评分视为 -1，排在最后
        arr.sort((a, b) => ((a.ai_score ?? -1) - (b.ai_score ?? -1)) * dir)
        break
      case 'risk':
        arr.sort((a, b) => (riskRank(a) - riskRank(b)) * dir)
        break
      case 'name':
        arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') * dir)
        break
      default:
        arr.sort((a, b) => (a.updated_at - b.updated_at) * dir)
    }
    return arr
  })

  // 分组视图：不分组返回单组；按风险等级 / 沟通状态分组
  const groups = computed<CompanyGroup[]>(() => {
    const list = sorted.value
    if (groupBy.value === 'risk') {
      const buckets = new Map<string, Company[]>()
      for (const c of list) {
        const k = c.risk_level || '未标注风险'
        const arr = buckets.get(k) ?? []
        arr.push(c)
        buckets.set(k, arr)
      }
      const order = ['极高', '高', '中', '低', '未标注风险']
      return order
        .filter((k) => buckets.has(k))
        .map((k) => {
          const items = buckets.get(k)!
          return { key: k, label: k, count: items.length, items }
        })
    }
    if (groupBy.value === 'status') {
      const active = list.filter((c) => !c.no_contact)
      const closed = list.filter((c) => c.no_contact)
      const out: CompanyGroup[] = []
      if (active.length) out.push({ key: 'active', label: '沟通中', count: active.length, items: active })
      if (closed.length) out.push({ key: 'closed', label: '不再沟通', count: closed.length, items: closed })
      return out
    }
    return [{ key: 'all', label: '全部', count: list.length, items: list }]
  })

  async function removeCompany(id: number) {
    await api.deleteCompany(id)
    await refresh()
  }

  return {
    companies,
    tagStats,
    stats,
    keyword,
    statusFilter,
    activeTags,
    sortBy,
    sortDir,
    groupBy,
    loading,
    error,
    hasFilters,
    baseList,
    sorted,
    groups,
    refresh,
    clearFilters,
    setKeyword,
    toggleStatus,
    toggleTag,
    setSortBy,
    setGroupBy,
    tagCount,
    removeCompany,
  }
})
