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
  await page.locator('#load-routing').click()
  await page.locator('.node').nth(7).waitFor()
  assert.equal(
    await page.locator('.node[data-node="route"] .port.out').count(),
    3
  )
  assert.equal(
    await page.locator('.node[data-node="start"] .port.in').count(),
    0
  )
  await page.locator('#close-inspector').click()
  await page.locator('#fit').click()
  // Select a distinct conditional exit and reconnect, then undo.
  await page
    .locator('.node[data-node="route"] .port.out[data-branch="deep"]')
    .click()
  await page.locator('.node[data-node="fast"] .port.in').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('替换')
  )
  await page.locator('#undo').click()
  // Configure a threshold through actual form controls.
  await page.locator('.node[data-node="route"] .node-top').click()
  const threshold = page
    .locator('#inspector label')
    .filter({ hasText: '比较值' })
    .first()
    .locator('input')
  await threshold.fill('0.8')
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v1')
  )
  assert.equal(
    f.store.definitions()[0].definition.nodes.find((n) => n.id === 'route')
      .config.cases[0].conditions[0].value,
    0.8
  )
  await page.locator('#open-run').click()
  await page.locator('#create-instance').click()
  await page.waitForFunction(() => !document.querySelector('#run').disabled)
  await page.locator('[data-run-field="task"]').fill('实际浏览器里的原始任务')
  await page.locator('#run').click()
  await page.waitForFunction(() =>
    document.querySelector('#run-status').textContent.includes('已完成')
  )
  assert.equal(await page.locator('.node[data-state="skipped"]').count(), 2)
  assert.equal(await page.locator('.node[data-state="completed"]').count(), 6)
  assert.match(
    await page.locator('#result').textContent(),
    /实际浏览器里的原始任务/
  )
  await page.locator('.node[data-node="decision"] .node-top').click()
  await page.locator('#inspector details').first().locator('summary').click()
  assert.match(
    await page.locator('#selected-node-result').textContent(),
    /confidence/
  )
  await page.locator('#close-inspector').click()
  await page.locator('#fit').click()
  await page.screenshot({ path: `${output}/routing-fast.png`, fullPage: true })
  // Use explicit fixture to exercise low-confidence human fallback.
  await page.locator('#show-settings').click()
  const router = page
    .locator('.resource-card')
    .filter({ hasText: 'router / model' })
  await router.locator('textarea').fill(
    JSON.stringify({
      route: {
        type: 'choice',
        choice: 'deep',
        confidence: 0.2,
        probabilities: { fast: 0.4, deep: 0.6 }
      }
    })
  )
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v2')
  )
  await page.locator('[data-run-field="task"]').fill('低置信度任务')
  await page.locator('[data-close="settings-panel"]').click()
  await page.locator('#run').click()
  await page.locator('#wait-box').waitFor({ state: 'visible' })
  await page.locator('.node[data-state="waiting"]').waitFor()
  assert.match(await page.locator('#wait-prompt').textContent(), /低置信度任务/)
  await page.locator('#fit').click()
  await page.screenshot({
    path: `${output}/routing-review.png`,
    fullPage: true
  })
  await page.locator('#wait-value').fill('人工审核后的最终结果')
  await page.locator('#resolve').click()
  await page.waitForFunction(() =>
    document.querySelector('#run-status').textContent.includes('已完成')
  )
  assert.match(
    await page.locator('#result').textContent(),
    /人工审核后的最终结果/
  )
  assert.equal(f.store.runs().length, 2)
  // Structured human review collects a validated object from native controls.
  await page.locator('.node[data-node="review"] .node-top').click()
  await page
    .locator('#inspector label')
    .filter({ hasText: '收集结构化审核表单' })
    .locator('input')
    .check()
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v3')
  )
  await page.locator('[data-run-field="task"]').fill('结构化审核任务')
  await page.locator('#close-inspector').click()
  await page.locator('#run').click()
  await page.locator('#wait-fields select').waitFor({ state: 'visible' })
  await page.locator('#wait-fields select').selectOption('approve')
  await page.locator('#wait-fields textarea').fill('审核通过')
  await page.screenshot({
    path: `${output}/routing-structured-review.png`,
    fullPage: true
  })
  await page.locator('#resolve').click()
  await page.waitForFunction(() =>
    document.querySelector('#run-status').textContent.includes('已完成')
  )
  assert.deepEqual(f.store.runs()[0].result, {
    action: 'approve',
    feedback: '审核通过'
  })
  // JEV resource config is editable and exportable without secrets.
  await page.locator('#show-settings').click()
  await router.locator('select').selectOption('jev')
  await router.locator('input').nth(2).fill('jev_key')
  await page.locator('#save').click()
  await page.waitForFunction(() =>
    document.querySelector('#notice').textContent.includes('已保存 v4')
  )
  const saved = f.store
    .definitions()[0]
    .definition.resources.find((r) => r.id === 'router')
  assert.equal(saved.config.baseUrl, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(saved.config.credential, 'jev_key')
  // Reopen UI from persistent API records and verify config is retained.
  await page.reload()
  await page.locator('.catalog-card').first().waitFor()
  await page.locator('#show-agents').click()
  await page
    .locator('#saved-agents')
    .selectOption(f.store.definitions()[0].agentId)
  await page.locator('#open-agent').click()
  await page.locator('.node').nth(7).waitFor()
  assert.equal(
    await page.locator('.node[data-node="route"] .port.out').count(),
    3
  )
  await page.locator('#theme').click()
  await page.screenshot({ path: `${output}/routing-light.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  )
  await page.screenshot({
    path: `${output}/routing-mobile.png`,
    fullPage: true
  })
  assert.deepEqual(errors, [])
  const evidence = {
    checks: [
      'conditional ports',
      'branch reconnect/undo',
      'visual threshold configuration',
      'typed task form',
      'exclusive execution/skips',
      'original task binding',
      'inspect decision result',
      'low confidence wait',
      'human resolve',
      'structured human review form',
      'JEV resource/credential handle save',
      'reload saved graph',
      'light theme',
      '390px responsive'
    ],
    browserErrors: errors,
    runs: f.store
      .runs()
      .map((r) => ({ status: r.status, skipped: r.skipped, result: r.result }))
  }
  writeFileSync(
    `${output}/routing-browser-result.json`,
    JSON.stringify(evidence, null, 2)
  )
  console.log(JSON.stringify(evidence))
} catch (error) {
  await page.screenshot({
    path: `${output}/routing-failure.png`,
    fullPage: true
  })
  console.log(
    JSON.stringify({
      notice: await page.locator('#notice').textContent(),
      browserErrors: errors
    })
  )
  throw error
} finally {
  await browser.close()
  await new Promise((r) => server.close(r))
  await f.close()
}
