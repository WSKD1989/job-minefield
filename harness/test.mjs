// 应聘避坑小工具 CLI · 进程内集成测试
// 直接调用 cli.mjs 的 main()，用内存 IO 捕获输出。运行: node test.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './cli.mjs'

const dir = mkdtempSync(join(tmpdir(), 'yingpin-cli-test-'))
const dbPath = join(dir, 'bikeng.db')
const envBackup = process.env.BIKENG_DB_PATH
process.env.BIKENG_DB_PATH = dbPath

let passed = 0, failed = 0
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✓', name) }
  else { failed++; console.error('  ✗', name, extra) }
}

async function run(argv, stdinText = '') {
  const stdout = [], stderr = []
  const io = {
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    stdin: async () => stdinText,
  }
  const code = await main(argv, io)
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

const J = (s) => { try { return JSON.parse(s) } catch { return null } }

async function mainTest() {
  console.log('== 基础 ==')
  let r = await run(['--version'])
  ok('--version', r.code === 0 && /^0\.4\./.test(r.stdout), JSON.stringify(r))
  r = await run([])
  ok('无参数显示帮助', r.code === 0 && r.stdout.includes('用法:'))
  r = await run(['nope'])
  ok('未知子命令退出码 2', r.code === 2, JSON.stringify(r.code))

  console.log('== 录入 ==')
  r = await run(['add-company', '测试软件公司', '--industry', '互联网', '--website', 'https://t.example', '--description', '做外包的', '--risk-level', '中'])
  ok('add-company 成功', r.code === 0 && r.stdout.includes('已添加公司 #1'), r.stdout)
  r = await run(['add-company', '甲方案例科技'])
  ok('add-company 最小参数', r.code === 0 && r.stdout.includes('#2'))
  r = await run(['add-company'])
  ok('add-company 缺名称退出码 2', r.code === 2)

  console.log('== 查询 ==')
  r = await run(['list', '--json'])
  const all = J(r.stdout)
  ok('list --json 返回数组', r.code === 0 && Array.isArray(all) && all.length === 2)
  r = await run(['list', '测试软件', '--json'])
  const kw = J(r.stdout)
  ok('list 关键词过滤', kw.length === 1 && kw[0].id === 1)
  r = await run(['get', '1', '--json'])
  const d1 = J(r.stdout)
  ok('get 详情', r.code === 0 && d1.company.name === '测试软件公司' && d1.company.risk_level === '中')
  r = await run(['get', '999', '--json'])
  ok('get 不存在退出码 1', r.code === 1, JSON.stringify(r))
  r = await run(['get', 'abc'])
  ok('get 非法 ID 退出码 2', r.code === 2)

  console.log('== 标签/岗位/投递/对话 ==')
  r = await run(['tag', '1', '外包'])
  r = await run(['tag', '1', '外包'])
  r = await run(['tag', '1', '避雷'])
  r = await run(['list', '--tag', '外包', '--json'])
  const byTag = J(r.stdout)
  ok('tag 与重复忽略', byTag.length === 1 && byTag[0].id === 1)
  r = await run(['tag', '999', '外包'])
  ok('tag 不存在公司退出码 1', r.code === 1)

  r = await run(['add-position', '1', '前端开发', '--salary-min', '12k', '--salary-max', '18k', '--hr', '李HR', '--work-type', 'onsite'])
  ok('add-position 成功', r.code === 0 && r.stdout.includes('岗位 #1'))
  r = await run(['add-position', '1'])
  ok('add-position 缺岗位名退出码 2', r.code === 2)
  r = await run(['update-position', '1', '--title', '高级前端开发', '--salary-max', '20k'])
  ok('update-position 成功', r.code === 0)
  r = await run(['get', '1', '--json'])
  const d2 = J(r.stdout)
  ok('岗位更新生效', d2.positions[0].title === '高级前端开发' && d2.positions[0].salary_max === '20k')

  r = await run(['apply', '1', '--channel', 'BOSS直聘'])
  ok('apply 成功', r.code === 0)
  r = await run(['get', '1', '--json'])
  ok('投递计数 +1', J(r.stdout).applyCount === 1)

  r = await run(['chat', '1', '--role', '对方', '--contact', '李HR', '--content', '我们这边是外包岗位，能接受吗？', '--platform', 'BOSS直聘'])
  ok('chat 参数传入成功', r.code === 0 && r.stdout.includes('对话 #1'))
  r = await run(['chat', '1', '--role', '我方', '--content', '-'], '可以接受，请问薪资范围是？')
  ok('chat 从 stdin 读取内容', r.code === 0)
  r = await run(['chat', '1', '--role', '对方'])
  ok('chat 缺内容退出码 2', r.code === 2)
  r = await run(['chat', '1', '--role', 'HR', '--content', 'x'])
  ok('chat 非法角色退出码 2', r.code === 2)
  r = await run(['get', '1', '--json'])
  const d3 = J(r.stdout)
  ok('对话按顺序保留', d3.chats.length === 2 && d3.chats[0].content.includes('薪资范围'))

  console.log('== 更新公司 ==')
  r = await run(['update-company', '1', '--risk-level', '高', '--risk-note', '疑似外包转正难'])
  ok('update-company 成功', r.code === 0)
  r = await run(['update-company', '1', '--name', '测试软件集团'])
  r = await run(['get', '1', '--json'])
  const d4 = J(r.stdout)
  ok('公司更新生效', d4.company.name === '测试软件集团' && d4.company.risk_level === '高' && d4.company.risk_note === '疑似外包转正难')
  r = await run(['update-company', '999', '--name', 'x'])
  ok('update 不存在公司退出码 1', r.code === 1)

  console.log('== 评分（未配置 Key） ==')
  r = await run(['score', '1'])
  ok('score 未配置 Key 退出码 1 且提示', r.code === 1 && r.stderr.includes('API Key'), r.stderr)
  r = await run(['score', 'abc'])
  ok('score 非法 ID 退出码 2', r.code === 2)

  console.log('== 删除 ==')
  r = await run(['delete-company', '1'])
  ok('delete 缺 --yes 退出码 2', r.code === 2)
  r = await run(['delete-company', '1', '--yes'])
  ok('delete --yes 成功', r.code === 0)
  r = await run(['get', '1'])
  ok('删除后查询失败退出码 1', r.code === 1)
  r = await run(['get', '2', '--json'])
  const d5 = J(r.stdout)
  ok('级联删除不影响其他公司', d5 !== null && d5.company.id === 2)

  console.log('== db / doctor ==')
  r = await run(['db'])
  ok('db 显示路径', r.code === 0 && r.stdout.trim() === dbPath)
  r = await run(['doctor', '--json'])
  const doc = J(r.stdout)
  ok('doctor 报告', r.code === 0 && doc.node && doc.tables.includes('companies') && doc.api_key_configured === false)
  r = await run(['--db', dbPath, 'db'])
  ok('--db 覆盖路径', r.code === 0 && r.stdout.trim() === dbPath)

  console.log('== 帮助 ==')
  r = await run(['--help'])
  ok('--help 退出码 0 且含子命令', r.code === 0 && r.stdout.includes('add-company') && r.stdout.includes('score'))

  process.env.BIKENG_DB_PATH = envBackup
  rmSync(dir, { recursive: true, force: true })
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
  process.exit(failed === 0 ? 0 : 1)
}

mainTest().catch((e) => { console.error('测试异常:', e); process.exit(1) })