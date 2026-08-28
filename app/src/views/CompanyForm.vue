<script setup lang="ts">
// 公司新增 / 编辑表单
import { onBeforeRouteLeave } from 'vue-router'
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Save, ArrowLeft } from '@lucide/vue'
import { api } from '../api'
import { confirm, toast } from '../ui'
import type { CompanyInput } from '../types'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id ?? 0)
const isEdit = id > 0

const busy = ref(false)
const form = reactive<CompanyInput>({
  name: '',
  industry: null,
  website: null,
  address: null,
  contact: null,
  description: null,
  risk_level: null,
  risk_note: null,
  no_contact: false,
})

// ---------- 脏数据检测：离开前提示未保存 ----------
const dirty = ref(false)
const savedClean = ref(false)
let snapshot = ''

function snapshotForm() {
  snapshot = JSON.stringify(form)
}
// 表单内容相对快照变化 → 标记脏（sync 确保用户立即点返回时状态已就绪）
watch(
  () => JSON.stringify(form),
  (v) => {
    if (v !== snapshot) dirty.value = true
  },
  { flush: 'sync' },
)
onBeforeRouteLeave(async () => {
  // 已保存或未修改则直接放行
  if (savedClean.value || !dirty.value) return true
  const go = await confirm('有未保存的修改，确定离开吗？未保存的内容将丢失。')
  return go
})

const RISK_LEVELS = ['', '低', '中', '高', '极高']

onMounted(async () => {
  if (isEdit) {
    const detail = await api.getCompany(id)
    if (!detail) {
      toast('公司不存在', 'error')
      router.push('/')
      return
    }
    const c = detail.company
    Object.assign(form, {
      name: c.name,
      industry: c.industry,
      website: c.website,
      address: c.address,
      contact: c.contact,
      description: c.description,
      risk_level: c.risk_level,
      risk_note: c.risk_note,
      no_contact: c.no_contact,
    })
  }
  // 填充完成后建立快照，后续编辑才视为脏
  snapshotForm()
})

async function save() {
  if (!form.name.trim()) {
    toast('请填写公司名称', 'error')
    return
  }
  busy.value = true
  try {
    if (isEdit) {
      await api.updateCompany(id, form)
      savedClean.value = true
      router.push(`/company/${id}`)
    } else {
      // 同名查重：避免重复收录同一家
      const dupes = await api.listCompanies(form.name.trim(), '')
      if (dupes.length > 0 && dupes.some((c) => c.name === form.name.trim())) {
        const go = await confirm(
          `已存在同名公司「${form.name.trim()}」。仍要新建吗？（建议回到已有记录补充信息）`,
        )
        if (!go) return
      }
      const nid = await api.createCompany(form)
      savedClean.value = true
      router.push(`/company/${nid}`)
    }
  } catch (e) {
    toast(`保存失败：${e}`, 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <button class="icon-btn" title="返回" @click="router.back()">
        <ArrowLeft :size="18" />
      </button>
      <h2>{{ isEdit ? '编辑公司' : '收录新公司' }}</h2>
    </div>

    <form class="card body" @submit.prevent="save">
      <label class="field">
        <span>公司名称 *</span>
        <input v-model="form.name" placeholder="例如：深圳某某科技有限公司" />
      </label>

      <div class="two">
        <label class="field">
          <span>所属行业</span>
          <input v-model="form.industry" placeholder="外包 / 金融 / 互联网 / 制造业…" />
        </label>
        <label class="field">
          <span>公司网站</span>
          <input v-model="form.website" placeholder="https://…" />
        </label>
      </div>

      <div class="two">
        <label class="field">
          <span>公司地址</span>
          <input v-model="form.address" placeholder="所在城市/园区" />
        </label>
        <label class="field">
          <span>联系人 / HR</span>
          <input v-model="form.contact" placeholder="姓名、职位、微信" />
        </label>
      </div>

      <label class="field">
        <span>公司简介</span>
        <textarea
          v-model="form.description"
          rows="3"
          placeholder="规模、业务、自研或外包性质、社保公积金、加班情况等"
        />
      </label>

      <div class="two">
        <label class="field">
          <span>人工风险等级</span>
          <select v-model="form.risk_level">
            <option v-for="l in RISK_LEVELS" :key="l" :value="l || null">{{ l || '未标注' }}</option>
          </select>
        </label>
        <label class="field">
          <span>风险备注</span>
          <input v-model="form.risk_note" placeholder="如：社保不正规 / 疑似套路培训" />
        </label>
      </div>

      <label class="check">
        <input v-model="form.no_contact" type="checkbox" />
        <span>不再沟通（标记后列表卡片将置灰显示，用于已结束/放弃的公司）</span>
      </label>

      <div class="foot">
        <button class="btn-primary" type="submit" :disabled="busy">
          <Save :size="16" /> {{ isEdit ? '保存修改' : '保存并继续' }}
        </button>
        <button class="btn-soft" type="button" @click="router.back()">取消</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.page {
  max-width: 760px;
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
  flex: 1;
}

.field span {
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text-primary);
}

textarea {
  resize: vertical;
}

.two {
  display: flex;
  gap: var(--space-4);
}

.foot {
  display: flex;
  gap: 10px;
  margin-top: var(--space-1);
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-base);
  color: var(--color-text-primary);
  cursor: pointer;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: #fafbfc;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.check:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-weak);
}

.check input[type="checkbox"] {
  accent-color: var(--color-primary);
}
</style>