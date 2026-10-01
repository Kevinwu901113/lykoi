import { pathToFileURL } from 'node:url'
const { Window } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'happy-dom')
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const project = process.cwd()
const { ComposerStore, ComponentRegistry, ComposerEngine, builtins } = await import(
  'file://' + project + '/packages/lykoi-composer/src/index.ts'
)
const { createApi } = await import('file://' + project + '/packages/lykoi-composer/src/server.ts')
const root = mkdtempSync(join(tmpdir(), 'composer-dom-'))
const store = new ComposerStore(join(root, 'db.sqlite'))
const registry = new ComponentRegistry()
builtins.forEach((c) => registry.register(c))
const engine = new ComposerEngine(store, registry, { workspaceRoot: join(root, 'files') })
const route = createApi(store, registry, engine)
const window = new Window({ url: 'http://localhost:4310' })
window.structuredClone = structuredClone
window.fetch = async (url, init = {}) => {
  try {
    return new Response(
      JSON.stringify(await route(init.method ?? 'GET', url, init.body ? JSON.parse(init.body) : {})),
      { status: 200 }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400 })
  }
}
let poll
window.setInterval = (fn) => {
  poll = fn
  return 1
}
try {
  window.document.write(
    readFileSync('packages/lykoi-composer/public/index.html', 'utf8').replace(
      /<script[\s\S]*?<\/script>/g,
      ''
    )
  )
  await window.eval(`(async()=>{${readFileSync('packages/lykoi-composer/public/app.js', 'utf8')}\n})()`)
  const $ = (id) => window.document.getElementById(id)
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return
      await new Promise((r) => setTimeout(r, 5))
    }
    throw Error('DOM state not reached: ' + $('notice').textContent)
  }
  $('load-demo').click()
  await until(() => $('nodes').children.length === 4)
  $('save').click()
  await until(() => $('notice').textContent.includes('已保存 v1'))
  $('create-instance').click()
  await until(() => !$('run').disabled)
  $('run-input').value = '验证装配界面'
  $('run').click()
  await until(() => store.runs().length === 1)
  await engine.idle(store.runs()[0].id)
  poll()
  await until(() => !$('wait-box').hidden)
  $('wait-value').value = '人工确认完成'
  $('resolve').click()
  await until(() => store.runs()[0].status === 'succeeded')
  poll()
  await until(() => $('run-status').textContent.includes('已完成'))
  console.log(
    JSON.stringify({
      components: $('nodes').children.length,
      status: $('run-status').textContent,
      result: $('result').textContent,
      trace: $('trace').children.length,
      notice: $('notice').textContent
    })
  )
} finally {
  await engine.close()
  store.close()
  await window.happyDOM.close()
  rmSync(root, { recursive: true, force: true })
}
