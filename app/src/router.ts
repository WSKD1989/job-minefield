// 路由配置
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    { path: '/company/new', name: 'company-new', component: () => import('./views/CompanyForm.vue') },
    { path: '/company/:id/edit', name: 'company-edit', component: () => import('./views/CompanyForm.vue') },
    { path: '/company/:id', name: 'company-detail', component: () => import('./views/CompanyDetail.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  ],
})

export default router