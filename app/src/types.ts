// 与 Rust 后端结构体对应的前端类型定义
export interface Company {
  id: number
  name: string
  industry: string | null
  website: string | null
  address: string | null
  contact: string | null
  description: string | null
  risk_level: string | null
  risk_note: string | null
  ai_score: number | null
  ai_summary: string | null
  ai_detail: string | null
  biz_info: string | null
  no_contact: boolean
  tags: string[]
  created_at: number
  updated_at: number
}

export interface CompanyInput {
  name: string
  industry?: string | null
  website?: string | null
  address?: string | null
  contact?: string | null
  description?: string | null
  risk_level?: string | null
  risk_note?: string | null
  no_contact?: boolean
}

export interface Position {
  id: number
  company_id: number
  title: string
  salary_min: string | null
  salary_max: string | null
  salary_note: string | null
  location: string | null
  work_type: string | null
  hr_contact: string | null
  note: string | null
  created_at: number
}

export interface PositionInput {
  company_id: number
  title: string
  salary_min?: string | null
  salary_max?: string | null
  salary_note?: string | null
  location?: string | null
  work_type?: string | null
  hr_contact?: string | null
  note?: string | null
}

export interface ChatMsg {
  id: number
  company_id: number
  position_id: number | null
  platform: string | null
  contact: string | null
  role: string
  content: string
  created_at: number
}

export interface ChatInput {
  company_id: number
  position_id?: number | null
  platform?: string | null
  contact?: string | null
  role: string
  content: string
}

export interface Application {
  id: number
  company_id: number
  applied_at: number
  channel: string | null
  note: string | null
}

export interface ApplicationInput {
  company_id: number
  applied_at?: number | null
  channel?: string | null
  note?: string | null
}

export interface CompanyDetail {
  company: Company
  positions: Position[]
  tags: string[]
  applications: Application[]
  chats: ChatMsg[]
  apply_count: number
}

export interface TagStat {
  tag: string
  count: number
}

export interface ScoreResult {
  company_id: number
  score: number
  summary: string
  risk_level: string
  detail: string
}

export interface SettingsOut {
  api_key: string
  base_url: string
  model: string
}

export interface Stats {
  company_count: number
  apply_count: number
  scored_count: number
  avg_score: number | null
}

/** 备份导入结果统计 */
export interface ImportSummary {
  companies: number
  positions: number
  chats: number
  applications: number
  tags: number
  skipped: number
}

// 预置公司标签
export const PRESET_TAGS = [
  '甲方',
  '乙方',
  '外派岗位',
  '外包岗位',
  '自研',
  '人力外包',
  '猎头',
  '面试已通过',
  '已投递',
  '未回复',
  '已读不回',
  '风险高',
  '避雷',
]

export const WORK_TYPES = [
  { label: '驻场/到岗', value: 'onsite' },
  { label: '远程', value: 'remote' },
  { label: '混合', value: 'hybrid' },
]