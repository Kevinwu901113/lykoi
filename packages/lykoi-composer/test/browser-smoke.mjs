// Optional real-browser acceptance. Tooling paths are explicit; no runtime dependencies.
// node test/browser-smoke.mjs /path/to/playwright-core/index.mjs /path/to/chromium/build/index.js /output/directory
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { createComposerServer } from '../src/server.ts'
const { chromium: playwright } = await import(
  pathToFileURL(process.argv[2]).href
)
const { default: chromium } = await import(pathToFileURL(process.argv[3]).href)
const output = resolve(process.argv[4])
mkdirSync(output, { recursive: true })
const f = fixture(),
  server = createComposerServer(f.store, f.registry, f.engine)
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(
    (arg) =>
      !['--disable-web-security', '--allow-running-insecure-content'].includes(
        arg
      )
  ),
  headless: true
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.catalog-card').first().waitFor()
  await page.locator('#load-demo').click()
  await page.locator('.node').nth(3).waitFor()
  const first = page.locator('.node').first(),
    before = await first.boundingBox()
  const header = await first.locator('.node-top').boundingBox()
  await page.mouse.move(header.x + 50, header.y + 20)
  await page.mouse.down()
  await page.mouse.move(header.x + 115, header.y + 65, { steps: 8 })
  await page.mouse.up()
  const moved = await first.boundingBox()
  assert.ok(moved.x > before.x + 50, 'real pointer drag moves node')
  await page.locator('#undo').click()
  assert.ok(
    Math.abs((await first.boundingBox()).x - before.x) < 1,
    'undo restores coordinates'
  )
  await page.locator('#redo').click()
  assert.ok((await first.boundingBox()).x > before.x + 50)
  await page.locator('#arrange').click()
  // Hide inspector to exercise port drag without overlay occlusion.
  await page.locator('#close-inspector').click()
  await page.locator('#fit').click()
  const source = page.locator('.node').nth(0).locator('.port.out'),
    target = page.locator('.node').nth(2).locator('.port.in')
  const a = await source.boundingBox(),
    b = await target.boundingBox()
  await page.mouse.move(a.x + 8, a.y + 8)
  await page.mouse.down()
  await page.mouse.move(b.x + 8, b.y + 8, { steps: 12 })
  await page.mouse.up()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('替换')
  )
  assert.equal(await page.locator('.wire').count(), 3)
  await page.locator('#undo').click()
  await page.locator('.node').nth(3).locator('.port.out').click()
  await page.locator('.node').nth(0).locator('.port.in').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('环路')
  )
  await page.keyboard.press('Escape')
  const zoom = await page.locator('#zoom-level').textContent()
  await page.mouse.move(650, 350)
  await page.mouse.wheel(0, -180)
  assert.notEqual(await page.locator('#zoom-level').textContent(), zoom)
  await page.locator('#fit').click()
  await page.locator('.node').nth(1).locator('.node-top').click()
  const advanced = page.locator('.advanced-config summary')
  await advanced.click()
  const originalConfig = await page.locator('#node-config').inputValue()
  await page.locator('#node-config').fill('{invalid')
  await page.locator('.node').nth(2).locator('.node-top').click()
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('JSON 无效')
  )
  await page.locator('.node').nth(1).locator('.node-top').click()
  await page.locator('.advanced-config summary').click()
  assert.equal(
    await page.locator('#node-config').inputValue(),
    '{invalid',
    'invalid draft survives selection'
  )
  await page.locator('#node-config').fill(originalConfig)
  await page.locator('.advanced-config summary').click()
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v1')
  )
  await page.screenshot({ path: `${output}/preview-dark.png`, fullPage: true })
  await page.locator('#theme').click()
  await page.screenshot({ path: `${output}/preview-light.png`, fullPage: true })
  await page.locator('#theme').click()
  await page.locator('#show-agents').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export').click()
  ])
  const exportPath = await download.path()
  const exported = JSON.parse(readFileSync(exportPath, 'utf8'))
  assert.equal(Object.keys(exported.editor.positions).length, 4)
  await page.locator('#import').setInputFiles(exportPath)
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已导入为新的')
  )
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v1')
  )
  assert.equal(f.store.definitions().length, 2, 'import creates a new identity')
  await page.locator('#open-run').click()
  await page.locator('#create-instance').click()
  await page.locator('#run').waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('#run').disabled)
  await page.locator('#run-input').fill('检查这次装配流程')
  await page.locator('#run').click()
  await page.locator('#wait-box').waitFor({ state: 'visible' })
  await page.locator('#fit').click()
  await page.locator('.node[data-state="waiting"]').waitFor()
  await page.screenshot({
    path: `${output}/preview-waiting.png`,
    fullPage: true
  })
  await page.locator('#wait-value').fill('人工确认完成')
  await page.locator('#resolve').click()
  await page.waitForFunction(() =>
    document.querySelector('#run-status').textContent.includes('已完成')
  )
  assert.equal(await page.locator('.node[data-state="completed"]').count(), 4)
  // Responsive layout: viewport fits; panels and run dock remain operable.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#toggle-run').click()
  await page.screenshot({
    path: `${output}/preview-mobile.png`,
    fullPage: true
  })
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    'no mobile horizontal overflow'
  )
  assert.deepEqual(errors, [], 'no page script errors')
  const evidence = {
    status: await page.locator('#run-status').textContent(),
    components: await page.locator('.node').count(),
    browserErrors: errors,
    checks: [
      'pointer drag',
      'undo/redo',
      'port drag',
      'cycle rejection',
      'zoom',
      'layout version save',
      'export/import new identity',
      'invalid config blocks save',
      'dark/light',
      'instance run',
      'persistent wait resolve',
      'node state',
      '390px responsive'
    ]
  }
  writeFileSync(
    `${output}/browser-result.json`,
    JSON.stringify(evidence, null, 2)
  )
  console.log(JSON.stringify(evidence))
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
  await f.close()
}
