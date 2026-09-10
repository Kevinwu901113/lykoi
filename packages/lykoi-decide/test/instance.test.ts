/**
 * 实例包装载面（WO-E4-2，E4-SPEC §3.2）：根 = persona TOML 所在目录；seeds.toml
 * 缺失 = 零种子、损坏 / 形状不对 = CharacterPackageError、一条 = 一条且内容一致。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import {
  CharacterPackageError, loadCharacterPackage, parseSeeds, SEEDS_FILENAME,
} from '../src/index.ts'
import { FIXTURE_PERSONA_TOML } from './persona-fixture.ts'

/** 临时实例包：persona.toml 只占位（装载面不读它的正文），seeds 按需写。 */
function instancePackage(seedsText: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-instance-'))
  const persona = join(dir, 'persona.toml')
  writeFileSync(persona, '', 'utf8')
  if (seedsText !== null) writeFileSync(join(dir, SEEDS_FILENAME), seedsText, 'utf8')
  return persona
}

test('合成实例包：根 = persona TOML 所在目录；seeds.toml 恰一条 preference，内容是合成值', () => {
  const pkg = loadCharacterPackage(FIXTURE_PERSONA_TOML)
  assert.equal(pkg.root, dirname(FIXTURE_PERSONA_TOML))
  assert.deepEqual(pkg.seeds, [
    ['preference', '合成种子：Owner 偏好用中文交流，技术术语用英文（测试实例包）'],
  ])
})

test('无 seeds.toml → 零种子（不是缺省一条）；根仍正确、相对路径归一为绝对', () => {
  const persona = instancePackage(null)
  assert.deepEqual(loadCharacterPackage(persona), { root: dirname(persona), seeds: [] })
  const asRelative = relative(process.cwd(), persona)
  assert.notEqual(asRelative, persona)
  assert.equal(loadCharacterPackage(asRelative).root, resolve(dirname(persona)))
})

test('一条 → 一条且内容一致；多类多条按键序 × 数组序展平', () => {
  const one = instancePackage('[seeds]\npreference = ["甲"]\n')
  assert.deepEqual(loadCharacterPackage(one).seeds, [['preference', '甲']])
  const many = instancePackage('[seeds]\npreference = ["甲", "乙"]\npersona = ["丙"]\n')
  assert.deepEqual(loadCharacterPackage(many).seeds, [
    ['preference', '甲'], ['preference', '乙'], ['persona', '丙'],
  ])
})

test('空文件 / 空表 / 空数组 → 零种子（合法的"什么都不种"）', () => {
  for (const text of ['', '# 只有注释\n', '[seeds]\n', '[seeds]\npreference = []\n']) {
    assert.deepEqual(loadCharacterPackage(instancePackage(text)).seeds, [], JSON.stringify(text))
  }
})

test('损坏 → CharacterPackageError（not valid TOML；出生证阶段抛错比静默好）', () => {
  const persona = instancePackage('[seeds\npreference = ["甲"]\n')
  assert.throws(
    () => loadCharacterPackage(persona),
    (exc: unknown) => exc instanceof CharacterPackageError
      && exc.message.startsWith(`${join(dirname(persona), SEEDS_FILENAME)} is not valid TOML: `),
  )
  // seeds.toml 是目录（读不了）也抛，不当作缺失。
  const dirCase = instancePackage(null)
  mkdirSync(join(dirname(dirCase), SEEDS_FILENAME))
  assert.throws(() => loadCharacterPackage(dirCase), CharacterPackageError)
})

test('形状不对 → CharacterPackageError（别的表名 / 根键 / 非字符串数组 / 空字符串）', () => {
  for (const text of [
    '[other]\npreference = ["甲"]\n',
    '[seeds]\npreference = ["甲"]\n[other]\nx = ["乙"]\n',
    'seeds = ["甲"]\n',
    '[seeds]\npreference = "甲"\n',
    '[seeds]\npreference = [1]\n',
    '[seeds]\npreference = [""]\n',
    '[seeds]\npreference = ["甲", "  "]\n',
  ]) {
    assert.throws(() => parseSeeds(text, 'seeds.toml'), CharacterPackageError, JSON.stringify(text))
  }
})

test('birth package ignores unrelated broken deployment files', () => {
  const persona = instancePackage('[seeds]\npreference = ["birth"]\n')
  writeFileSync(join(dirname(persona), 'deploy.toml'), 'BROKEN DEPLOYMENT')
  assert.deepEqual(loadCharacterPackage(persona).seeds, [['preference', 'birth']])
})
