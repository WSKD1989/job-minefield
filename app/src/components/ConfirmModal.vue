<script setup lang="ts">
// 自定义确认弹窗：替代原生 window.confirm，与设计系统统一
import { ref, watch } from 'vue'
import { TriangleAlert } from '@lucide/vue'

const props = defineProps<{ show: boolean; message: string }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const visible = ref(false)

watch(
  () => props.show,
  (v) => {
    visible.value = v
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="overlay" @click.self="emit('cancel')">
        <div class="dialog card" role="dialog" aria-modal="true">
          <div class="dialog-icon">
            <TriangleAlert :size="22" />
          </div>
          <p class="dialog-message">{{ message }}</p>
          <div class="dialog-actions">
            <button class="btn-soft" @click="emit('cancel')">取消</button>
            <button class="btn-primary danger-btn" @click="emit('confirm')">确认</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(2px);
}

.dialog {
  width: 360px;
  max-width: 90vw;
  padding: var(--space-6) var(--space-5) var(--space-5);
  text-align: center;
}

.dialog-icon {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-3);
  color: var(--color-warning);
}

.dialog-message {
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--color-text-primary);
  margin-bottom: var(--space-5);
  word-break: break-word;
}

.dialog-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
}

.danger-btn {
  background: var(--color-danger) !important;
  color: #fff !important;
}

.danger-btn:hover {
  background: var(--color-danger-hover) !important;
}

/* 过渡动画 */
.modal-enter-active {
  transition: opacity 0.15s ease;
}
.modal-enter-active .dialog {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.modal-leave-active {
  transition: opacity 0.1s ease;
}
.modal-leave-active .dialog {
  transition: transform 0.1s ease, opacity 0.1s ease;
}
.modal-enter-from {
  opacity: 0;
}
.modal-enter-from .dialog {
  transform: scale(0.92);
  opacity: 0;
}
.modal-leave-to {
  opacity: 0;
}
.modal-leave-to .dialog {
  transform: scale(0.95);
  opacity: 0;
}
</style>