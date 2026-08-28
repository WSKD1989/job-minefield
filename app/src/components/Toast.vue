<script setup lang="ts">
// Toast 通知组件：替代原生 alert()，与设计系统统一
import { ref, watch } from 'vue'
import { CircleCheck, CircleX, Info, X } from '@lucide/vue'
import { toastState, type ToastItem } from '../ui'

const TIMEOUT = 4000 // 自动消失时间

const items = ref<ToastItem[]>([])

watch(
  () => toastState.id,
  () => {
    if (toastState.message) {
      const id = Date.now()
      items.value.push({ ...toastState, id })
      // 自动移除
      setTimeout(() => {
        items.value = items.value.filter((t) => t.id !== id)
      }, TIMEOUT)
    }
  },
)

function remove(id: number) {
  items.value = items.value.filter((t) => t.id !== id)
}

function icon(type: string) {
  if (type === 'success') return CircleCheck
  if (type === 'error') return CircleX
  return Info
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="t in items"
          :key="t.id"
          class="toast-item"
          :class="`toast-${t.type}`"
          role="alert"
        >
          <component :is="icon(t.type)" :size="16" class="toast-icon" />
          <span class="toast-text">{{ t.message }}</span>
          <button class="toast-close" title="关闭" @click="remove(t.id)">
            <X :size="14" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 380px;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
}

.toast-icon {
  flex-shrink: 0;
}

.toast-text {
  flex: 1;
  word-break: break-word;
}

.toast-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--color-text-tertiary);
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toast-close:hover {
  background: var(--color-bg);
  color: var(--color-text-primary);
}

/* 类型颜色 */
.toast-success .toast-icon {
  color: var(--color-success);
}
.toast-success {
  border-left: 3px solid var(--color-success);
}

.toast-error .toast-icon {
  color: var(--color-danger);
}
.toast-error {
  border-left: 3px solid var(--color-danger);
  animation: toast-shake 0.4s ease 0.25s;
}

.toast-info .toast-icon {
  color: var(--color-primary);
}
.toast-info {
  border-left: 3px solid var(--color-primary);
}

/* 过渡动画 */
.toast-enter-active {
  transition: all 0.25s ease;
}
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(30px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

/* 错误提示：入场后轻微抖动提醒 */
@keyframes toast-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  50% { transform: translateX(4px); }
  75% { transform: translateX(-2px); }
}
</style>