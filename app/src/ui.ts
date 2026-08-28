// 轻量 UI 辅助：确认弹窗 + Toast 通知
import { reactive } from 'vue'

// ========== 确认弹窗 ==========

interface ConfirmState {
  show: boolean
  message: string
  resolve: ((value: boolean) => void) | null
}

/** 确认弹窗全局状态 */
export const confirmState = reactive<ConfirmState>({
  show: false,
  message: '',
  resolve: null,
})

/**
 * 二次确认弹窗（异步，返回用户是否选择"确认"）
 * 替代原生 window.confirm，与设计系统视觉统一
 */
export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.show = true
    confirmState.resolve = resolve
  })
}

/** 内部：关闭弹窗并返回结果 */
export function resolveConfirm(value: boolean) {
  confirmState.resolve?.(value)
  confirmState.show = false
  confirmState.resolve = null
}

// ========== Toast 通知 ==========

export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
}

interface ToastState {
  message: string
  type: 'info' | 'success' | 'error'
  id: number
}

/** Toast 通知全局状态 */
export const toastState = reactive<ToastState>({
  message: '',
  type: 'info',
  id: 0,
})

/**
 * 显示 Toast 通知（替代原生 alert）
 * @param message 通知内容
 * @param type 类型：info / success / error
 */
export function toast(message: string, type: 'info' | 'success' | 'error' = 'info') {
  toastState.message = message
  toastState.type = type
  toastState.id = Date.now()
}