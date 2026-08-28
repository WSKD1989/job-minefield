<script setup lang="ts">
// 设置：配置 DeepSeek API、数据备份导入导出
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Save, ArrowLeft, KeyRound, Download, Upload, FileJson2, X, Loader2 } from '@lucide/vue'
import { api } from '../api'
import { toast } from '../ui'
import type { ImportSummary } from '../types'

const router = useRouter()
const busy = ref(false)
const form = reactive({ api_key: '', base_url: '', model: '' })

onMounted(async () => {
  const s = await api.getSettings()
  form.api_key = s.api_key
  form.base_url = s.base_url
  form.model = s.model
})

async function save() {
  busy.value = true
  try {
    await api.saveSettings(form.api_key.trim(), form.base_url.trim(), form.model.trim())
    toast('设置已保存', 'success')
  } catch (e) {
    toast(`保存失败：${e}`, 'error')
  } finally {
    busy.value = false
  }
}

// 导出全部数据为 JSON 备份
async function doExport() {
  try {
    const json = await api.exportData()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `应聘避坑备份_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('备份已导出', 'success')
  } catch (e) {
    toast(`导出失败：${e}`, 'error')
  }
}

// ---------- 备份导入 ----------
const importInput = ref<HTMLInputElement | null>(null)
const importState = ref<'idle' | 'preview' | 'done'>('idle')
const preview = ref({ companies: 0, positions: 0, chats: 0, applications: 0 })
const result = ref<ImportSummary | null>(null)
const importing = ref(false)

// 选择文件后解析 JSON 做预览（不落库）
function onPickFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const root = JSON.parse(String(reader.result))
      const list = root?.companies ?? []
      if (!Array.isArray(list)) {
        toast('不是有效的备份文件（缺少 companies 数据）', 'error')
        importState.value = 'idle'
        return
      }
      preview.value = {
        companies: list.length,
        positions: list.reduce((n: number, c: any) => n + (c.positions?.length ?? 0), 0),
        chats: list.reduce((n: number, c: any) => n + (c.chats?.length ?? 0), 0),
        applications: list.reduce((n: number, c: any) => n + (c.applications?.length ?? 0), 0),
      }
      importState.value = 'preview'
    } catch {
      toast('文件解析失败：不是有效的 JSON 备份', 'error')
      importState.value = 'idle'
    }
  }
  reader.readAsText(file)
}

function cancelImport() {
  importState.value = 'idle'
  result.value = null
}

// 确认后调用后端导入（同名公司自动跳过）
async function doImport() {
  if (!importInput.value?.files?.length) return
  importing.value = true
  try {
    const file = importInput.value.files[0]
    const text = await file.text()
    const r = await api.importData(text)
    result.value = r
    importState.value = 'done'
    toast(`导入完成：${r.companies} 家、${r.skipped} 家同名跳过`, 'success')
  } catch (e) {
    toast(`导入失败：${e}`, 'error')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <button class="icon-btn" title="返回" @click="router.back()">
        <ArrowLeft :size="18" />
      </button>
      <h2>设置</h2>
    </div>

    <div class="card body">
      <label class="field">
        <span><KeyRound :size="13" /> DeepSeek API Key</span>
        <input
          v-model="form.api_key"
          type="password"
          placeholder="sk-…"
          autocomplete="off"
        />
        <small class="muted">用于「AI 综合评分」；Key 仅保存在本机用于评分调用。</small>
      </label>

      <label class="field">
        <span>接口地址（可选）</span>
        <input v-model="form.base_url" placeholder="https://api.deepseek.com" />
      </label>

      <label class="field">
        <span>模型（可选）</span>
        <input v-model="form.model" placeholder="deepseek-chat" />
      </label>

      <div class="foot">
        <button class="btn-primary" :disabled="busy" @click="save">
          <Save :size="16" /> 保存设置
        </button>
      </div>
    </div>

    <div class="card body">
      <h3 class="brag">数据</h3>
      <!-- 导出 -->
      <label class="field">
        <span>导出备份</span>
        <small class="muted">将全部公司、岗位、对话、投递数据导出为 JSON 文件，便于迁移或归档。</small>
        <div class="foot">
          <button class="btn-soft" @click="doExport">
            <Download :size="15" /> 导出 JSON 备份
          </button>
        </div>
      </label>

      <div class="import-divider">或</div>

      <!-- 导入 -->
      <label class="field">
        <span>从备份恢复</span>
        <small class="muted">选择之前导出的 JSON 备份文件恢复数据。与现有同名公司会被自动跳过，不会覆盖已有记录。</small>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          style="display: none"
          @change="onPickFile"
        />
        <div class="foot">
          <button v-if="importState === 'idle'" class="btn-soft" @click="importInput?.click()">
            <Upload :size="15" /> 选择备份文件…
          </button>
          <button v-else class="btn-soft" @click="importInput?.click()">
            <FileJson2 :size="15" /> 重新选择
          </button>
        </div>
      </label>

      <!-- 导入预览 -->
      <div v-if="importState === 'preview'" class="import-preview">
        <div class="preview-grid">
          <div class="pv-item"><b>{{ preview.companies }}</b><span>家公司</span></div>
          <div class="pv-item"><b>{{ preview.positions }}</b><span>岗位</span></div>
          <div class="pv-item"><b>{{ preview.chats }}</b><span>对话</span></div>
          <div class="pv-item"><b>{{ preview.applications }}</b><span>投递</span></div>
        </div>
        <p class="muted hint">同名公司将被跳过（不覆盖现有数据）。</p>
        <div class="preview-actions">
          <button class="btn-primary" :disabled="importing" @click="doImport">
            <Loader2 v-if="importing" :size="15" class="spin" />
            <Upload v-else :size="15" />
            确认导入
          </button>
          <button class="btn-soft" :disabled="importing" @click="cancelImport">取消</button>
        </div>
      </div>

      <!-- 导入结果 -->
      <div v-else-if="importState === 'done' && result" class="import-result">
        <p class="ok-title">导入完成</p>
        <div class="preview-grid">
          <div class="pv-item"><b>{{ result.companies }}</b><span>新公司</span></div>
          <div class="pv-item"><b>{{ result.positions }}</b><span>岗位</span></div>
          <div class="pv-item"><b>{{ result.chats }}</b><span>对话</span></div>
          <div class="pv-item"><b>{{ result.applications }}</b><span>投递</span></div>
          <div class="pv-item"><b>{{ result.tags }}</b><span>标签</span></div>
          <div class="pv-item"><b>{{ result.skipped }}</b><span>同名跳过</span></div>
        </div>
        <button class="btn-soft" @click="cancelImport"><X :size="14" /> 完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 560px;
  margin: 0 auto;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: var(--space-4);
}

.head h2 {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
}

.brag {
  font-size: var(--text-md);
  margin: 0;
  font-weight: var(--weight-semibold);
  color: var(--color-text-primary);
}

.body {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-primary);
}

small {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.foot {
  margin-top: var(--space-1);
}

/* ---------- 导入预览 / 结果 ---------- */
.import-divider {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  text-align: center;
  position: relative;
  padding: 2px 0;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
  margin: var(--space-2) 0;
}

.import-result .preview-grid {
  grid-template-columns: repeat(3, 1fr);
}

.pv-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-1);
  background: var(--color-bg);
  border-radius: var(--radius-md);
}

.pv-item b {
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--color-primary);
}

.pv-item span {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.import-preview,
.import-result {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  background: #fafbff;
}

.ok-title {
  font-size: var(--text-md);
  font-weight: var(--weight-semibold);
  color: var(--color-success);
  text-align: center;
  margin-bottom: var(--space-1);
}

.hint {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  text-align: center;
}

.preview-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.import-result {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.import-result .btn-soft {
  margin-top: var(--space-2);
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}</style>