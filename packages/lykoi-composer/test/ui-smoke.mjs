import { pathToFileURL } from 'node:url'
const { Window } = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : 'happy-dom'
)
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const project = process.cwd()
const { ComposerStore, ComponentRegistry, ComposerEngine, builtins } =
  await import('file://' + project + '/packages/lykoi-composer/src/index.ts')
const { createApi } = await import(
  'file://' + project + '/packages/lykoi-composer/src/server.ts'
)
const root = mkdtempSync(join(tmpdir(), 'composer-dom-'))
const store = new ComposerStore(join(root, 'db.sqlite'))
const registry = new ComponentRegistry()
builtins.forEach((c) => registry.register(c))
const engine = new ComposerEngine(store, registry, {
  workspaceRoot: join(root, 'files')
})
const route = createApi(store, registry, engine)
const window = new Window({ url: 'http://localhost:4310' })
window.structuredClone = structuredClone
window.fetch = async (url, init = {}) => {
  try {
    return new Response(
      JSON.stringify(
        await route(
          init.method ?? 'GET',
          url,
          init.body ? JSON.parse(init.body) : {}
        )
      ),
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
  const graphCode = readFileSync(
    'packages/lykoi-composer/public/graph-editor.js',
    'utf8'
  ).replace(/^export /gm, '')
  const appCode = readFileSync(
    'packages/lykoi-composer/public/app.js',
    'utf8'
  ).replace(/^import [\s\S]*?from '\.\/graph-editor\.js'\n/, '')
  await window.eval(`(async()=>{${graphCode}\n${appCode}\n})()`)
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
  // Actual editor gestures, not a substitute implementation.
  const pointer = (target, type, x, y) =>
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        pointerId: 7,
        button: 0,
        clientX: x,
        clientY: y
      })
    )
  const canvas = $('canvas'),
    first = $('nodes').children[0],
    originalX = Number.parseFloat(first.style.left)
  pointer(first.querySelector('.node-top'), 'pointerdown', 100, 100)
  pointer(canvas, 'pointermove', 160, 120)
  pointer(canvas, 'pointerup', 160, 120)
  assert.ok(
    Number.parseFloat(first.style.left) > originalX,
    'drag moves node in graph coordinates'
  )
  $('undo').click()
  await until(
    () => Number.parseFloat($('nodes').children[0].style.left) === originalX
  )
  $('redo').click()
  await until(
    () => Number.parseFloat($('nodes').children[0].style.left) > originalX
  )
  const zoomBefore = $('zoom-level').textContent
  canvas.dispatchEvent(
    new window.WheelEvent('wheel', {
      bubbles: true,
      clientX: 400,
      clientY: 200,
      deltaY: -120
    })
  )
  assert.notEqual($('zoom-level').textContent, zoomBefore)
  // Cycle and type rejection leaves the saved graph unchanged.
  const output = (index) =>
    $('nodes').children[index].querySelector('.port.out')
  const input = (index) => $('nodes').children[index].querySelector('.port.in')
  output(3).click()
  input(0).click()
  assert.match($('notice').textContent, /类型不兼容|环路/)
  const edgeCount = $('edges').querySelectorAll('.wire').length
  // Explicitly cancel the prior source and choose prompt -> wait.
  window.document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  output(0).click()
  input(2).click()
  assert.equal(
    $('edges').querySelectorAll('.wire').length,
    edgeCount,
    'one input is replaced rather than duplicated'
  )
  assert.match($('notice').textContent, /替换/)
  $('undo').click()
  await until(() => $('edges').querySelectorAll('.wire').length === edgeCount)
  // Port dragging completes using the element under the released pointer.
  const target = input(2)
  window.document.elementFromPoint = () => target
  pointer(output(0), 'pointerdown', 200, 100)
  pointer(canvas, 'pointermove', 300, 150)
  pointer(canvas, 'pointerup', 300, 150)
  assert.match($('notice').textContent, /替换/)
  $('undo').click()
  await new Promise((r) => setTimeout(r, 10))
  $('show-settings').click()
  await until(() => !$('settings-panel').hidden)
  $('theme').click()
  await until(() => window.document.documentElement.dataset.theme === 'light')
  $('open-run').click()
  await until(() => !$('run-content').hidden)
  $('toggle-run').click()
  await until(() => $('run-content').hidden)
  $('save').click()
  await until(() => $('notice').textContent.includes('已保存 v1'))
  assert.equal(
    Object.keys(store.definitions()[0].definition.editor.positions).length,
    4,
    'layout persists with the version'
  )
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
