<script setup lang="ts">
// 应用外壳：顶部工具栏 + 路由内容 + 全局确认弹窗 + Toast 通知
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ShieldCheck, Settings, Plus, Home } from '@lucide/vue'
import ConfirmModal from './components/ConfirmModal.vue'
import Toast from './components/Toast.vue'
import { confirmState, resolveConfirm } from './ui'

const router = useRouter()

// 全局快捷键：Ctrl+N 新建公司
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    router.push('/company/new')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <button class="brand" title="回到首页" @click="router.push('/')">
        <span class="brand-icon"><ShieldCheck :size="20" /></span>
        <span>应聘避坑小工具</span>
      </button>
      <nav class="actions">
        <button class="icon-btn" title="新建公司 (Ctrl+N)" aria-label="新建公司" @click="router.push('/company/new')">
          <Plus :size="18" />
        </button>
        <button class="icon-btn" title="返回首页" aria-label="返回首页" @click="router.push('/')">
          <Home :size="18" />
        </button>
        <button class="icon-btn" title="设置" aria-label="设置" @click="router.push('/settings')">
          <Settings :size="18" />
        </button>
      </nav>
    </header>
    <main class="content">
      <router-view v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </router-view>
    </main>
    <!-- 全局确认弹窗 -->
    <ConfirmModal
      :show="confirmState.show"
      :message="confirmState.message"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
    <!-- 全局 Toast 通知 -->
    <Toast />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px var(--space-5);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  user-select: none;
  -webkit-app-region: drag;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--color-primary);
  -webkit-app-region: no-drag;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--color-brand-gradient);
  color: #fff;
  flex-shrink: 0;
}

.actions {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-5);
}

/* 页面切换过渡动画 */
.page-enter-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.page-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
}
</style>