// Tauri invoke 封装：前端调用 Rust 后端命令
import { invoke } from '@tauri-apps/api/core'
import type {
  ApplicationInput,
  ChatInput,
  Company,
  CompanyDetail,
  CompanyInput,
  ImportSummary,
  PositionInput,
  ScoreResult,
  SettingsOut,
  Stats,
  TagStat,
} from './types'

export const api = {
  // 公司
  listCompanies: (keyword = '', tag = '') =>
    invoke<Company[]>('list_companies', { keyword, tag }),
  getCompany: (id: number) => invoke<CompanyDetail | null>('get_company_detail', { id }),
  createCompany: (input: CompanyInput) => invoke<number>('create_company', { input }),
  updateCompany: (id: number, input: CompanyInput) => invoke<void>('update_company', { id, input }),
  deleteCompany: (id: number) => invoke<void>('delete_company', { id }),

  // 标签
  listTags: () => invoke<TagStat[]>('list_tags'),
  addTag: (companyId: number, tag: string) =>
    invoke<void>('add_company_tag', { companyId, tag }),
  removeTag: (companyId: number, tag: string) =>
    invoke<void>('remove_company_tag', { companyId, tag }),

  // 岗位
  addPosition: (input: PositionInput) => invoke<number>('add_position', { input }),
  updatePosition: (id: number, input: PositionInput) =>
    invoke<void>('update_position', { id, input }),
  deletePosition: (id: number) => invoke<void>('delete_position', { id }),

  // 对话
  addChat: (input: ChatInput) => invoke<number>('add_chat', { input }),
  deleteChat: (id: number) => invoke<void>('delete_chat', { id }),

  // 投递
  addApplication: (input: ApplicationInput) => invoke<number>('add_application', { input }),
  deleteApplication: (id: number) => invoke<void>('delete_application', { id }),

  // 设置
  getSettings: () => invoke<SettingsOut>('get_settings'),
  saveSettings: (api_key: string, base_url: string, model: string) =>
    invoke<void>('save_settings', { apiKey: api_key, baseUrl: base_url, model }),

  // 统计 / 导出
  getStats: () => invoke<Stats>('get_stats'),
  exportData: () => invoke<string>('export_data'),
  importData: (json: string) => invoke<ImportSummary>('import_data', { json }),

  // URL 抓取 / AI 解析
  fetchUrlText: (url: string) => invoke<string>('fetch_url_text', { url }),
  renderUrlText: (url: string) => invoke<string>('render_url_text', { url }),
  aiParseJob: (text: string) => invoke<Record<string, string>>('ai_parse_job', { text }),

  // 爱企查工商信息
  fetchAiqicha: (query: string) => invoke<string>('fetch_aiqicha', { query }),
  fetchBizUrl: (url: string) => invoke<string>('fetch_biz_url', { url }),
  queryBiz: (companyId: number, text: string) =>
    invoke<string>('query_biz', { companyId, text }),

  // AI 评分
  scoreCompany: (id: number) => invoke<ScoreResult>('score_company', { id }),
}