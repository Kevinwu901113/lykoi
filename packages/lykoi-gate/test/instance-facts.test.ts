import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanInstanceFacts } from '../src/instance-facts.ts'
import { CHECKS, checkInstanceFacts } from '../src/verify.ts'
import type { GateEnv } from '../src/verify.ts'

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'instance-facts-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, put(path: string, text: string) {
    const full = join(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text)
  } }
}

test('runtime literals fail; comments, identifiers, package paths and tests do not', t => {
  const f = fixture(t)
  f.put('packages/a/src/a.ts', `// Kevin\n/* Lykoi */\nimport x from 'lykoi-adapter-telegram'\nconst LykoiType = /Kevin/;\nconst good = 'https://example.test/#x';\nconst bad = 'Kevin';\nconst other = \`你好 Lykoi \${'Kevinwu901113'}\`;\nconst escaped = 'K\\u0065vin';`)
  f.put('packages/a/test/a.test.ts', '"Kevin"')
  f.put('governance/a.md', 'Kevin')
  const hits = scanInstanceFacts(f.root)
  assert.deepEqual(hits.map(h => h.token).sort(), ['Kevin', 'Kevin', 'Kevin', 'Kevinwu901113', 'Lykoi'].sort())
  assert.equal(hits.find(h => h.token === 'Kevin')!.line, 6)
  const problems: string[] = []
  checkInstanceFacts({ repoRoot: f.root } as GateEnv, problems)
  assert.equal(problems.length, 5)
  assert.ok(CHECKS.some(([name]) => name === 'instance_facts'))
})

test('configuration unquoted values checked; comments and quoted # handled', t => {
  const f = fixture(t)
  f.put('profile/cordis.yml', '# Kevin\nproxy: 192.168.0.202 # comment\nname: "# Kevin"')
  f.put('deploy/a.service.template', '# Lykoi\nDescription=Lykoi instance')
  assert.deepEqual(scanInstanceFacts(f.root).map(h => h.token).sort(), ['192.168.0.202', 'Kevin', 'Lykoi'].sort())
})

test('real framework tree has no instance literals', () => {
  assert.deepEqual(scanInstanceFacts(fileURLToPath(new URL('../../../', import.meta.url))), [])
})
