/**
 * persona TOML 装载面（SA-156；W5 身份收口）：fixture TOML → 与
 * persona-fixture.ts 数据逐字段相同 → 内核 sha 全等；装载失败姿态逐字
 * （not found / not valid TOML / 五 section 校验）；getPersona 进程级缓存。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative as relativePath } from 'node:path'
import {
  buildPersonaKernel, getPersona, loadPersona, parseTomlSubset, PersonaConfigError,
  resetPersonaCacheForTest,
} from '../src/index.ts'
import { FIXTURE_PERSONA } from './persona-fixture.ts'

const FIXTURE_TOML = new URL('./fixtures/lykoi_base.toml', import.meta.url).pathname

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function tmpToml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-persona-toml-'))
  const path = join(dir, 'p.toml')
  writeFileSync(path, content, 'utf8')
  return path
}

test('fixture TOML 装载 → 五 section 逐字段等于 persona-fixture 数据（同一数据两形态）', () => {
  assert.deepEqual(loadPersona(FIXTURE_TOML), FIXTURE_PERSONA)
})

test('fixture TOML → 内核九段 sha 全等（chars=401, 1f5960b7…；SA-154 装配点唯一的文件侧对拍）', () => {
  const kernel = buildPersonaKernel(loadPersona(FIXTURE_TOML))
  assert.equal([...kernel].length, 401)
  assert.equal(sha(kernel), '1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71')
})

test('装载失败姿态逐字：文件缺失 → "persona TOML not found: {target}"', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'lykoi-persona-toml-')), 'absent.toml')
  assert.throws(
    () => loadPersona(missing),
    (exc: unknown) =>
      exc instanceof PersonaConfigError && exc.message === `persona TOML not found: ${missing}`,
  )
})

test('装载失败姿态逐字：解析失败 → "persona TOML is not valid TOML: …"（子集外构造同姿态）', () => {
  for (const bad of [
    '[identity\nname = "x"', //           坏表头
    'name = = "x"', //                    坏赋值
    '[identity]\nwhen = 2026-08-24', //   日期（子集外，宁炸不歪读）
    '[identity]\nname = { a = 1 }', //    内联表（子集外）
  ]) {
    assert.throws(
      () => loadPersona(tmpToml(bad)),
      (exc: unknown) =>
        exc instanceof PersonaConfigError
        && exc.message.startsWith('persona TOML is not valid TOML: '),
    )
  }
})

test('装载失败姿态：缺 section / 缺字段 / 类型错 → parsePersonaData 的 fail-fast 文案（SA-156）', () => {
  // 缺 [interests]
  const noInterests = tmpToml(
    '[identity]\nname="L"\nself="s"\nnature_known=true\nembodiment="e"\n'
    + '[voice]\nlanguage="zh"\nregister="r"\nemoji="e"\naddress_owner="K"\nprofile_ref="d"\n'
    + '[relationship]\npartner="K"\nstance="s"\nevolution_anchor="a"\nowner_authority="o"\n'
    + '[personality]\ntraits=["t"]\nevolves=true\n',
  )
  assert.throws(
    () => loadPersona(noInterests),
    (exc: unknown) =>
      exc instanceof PersonaConfigError
      && exc.message === 'persona TOML missing [interests] section',
  )
  // 类型错：nature_known 非 boolean（其余 section 齐备 —— section 存在性检查在字段类型检查之前）
  const badBool = tmpToml(
    '[identity]\nname="L"\nself="s"\nnature_known="yes"\nembodiment="e"\n'
    + '[voice]\nlanguage="zh"\nregister="r"\nemoji="e"\naddress_owner="K"\nprofile_ref="d"\n'
    + '[relationship]\npartner="K"\nstance="s"\nevolution_anchor="a"\nowner_authority="o"\n'
    + '[personality]\ntraits=["t"]\nevolves=true\n'
    + '[interests]\nseeds=["s"]\n',
  )
  assert.throws(
    () => loadPersona(badBool),
    (exc: unknown) =>
      exc instanceof PersonaConfigError
      && exc.message === 'persona TOML [identity].nature_known must be a boolean',
  )
})

test('TOML 子集解析细节：注释/多行数组/字面字符串/转义/井号在字符串内', () => {
  const parsed = parseTomlSubset(
    '# 顶部注释\n'
    + '[a]\n'
    + 'x = "有 # 井号" # 行内注释\n'
    + "y = 'literal \\n 不转义'\n"
    + 'z = [\n  "一",\n  "二", # 注释\n]\n'
    + 'n = 3\nf = 0.5\nb = false\n'
    + 'esc = "a\\"b\\\\c\\nd"\n',
  )
  assert.deepEqual(parsed, {
    a: {
      x: '有 # 井号',
      y: 'literal \\n 不转义',
      z: ['一', '二'],
      n: 3,
      f: 0.5,
      b: false,
      esc: 'a"b\\c\nd',
    },
  })
})

// ===== getPersona 进程级缓存 + path 一致性守卫（D-CP-2/3，WO-CACHE-PERSONA） =====
//
// 缓存是模块级状态，`node --test` 每个测试文件一个进程 —— 同文件的用例共享它。
// 每条开头 resetPersonaCacheForTest()：唯有如此各条才不靠顺序活着，「失败不占坑」
// 那条也才真的从空缓存出发（缓存已热时它测到的会是守卫而不是装载失败）。

/** 与 fixture 同形、identity.name 不同的第二份**合法**内核 —— 守卫要挡的正是它。 */
function divergentToml(): string {
  const text = readFileSync(FIXTURE_TOML, 'utf8')
  const swapped = text.replace('name = "Lykoi"', 'name = "NotLykoi"')
  assert.notEqual(swapped, text, 'fixture 的 identity.name 行漂了，本用例的前提失效')
  return tmpToml(swapped)
}

test('getPersona 进程级缓存：第二次调用返回同一对象（改 TOML 需重启的契约面）', () => {
  resetPersonaCacheForTest()
  const first = getPersona(FIXTURE_TOML)
  const second = getPersona(FIXTURE_TOML)
  assert.equal(first, second)
  assert.deepEqual(first, FIXTURE_PERSONA)
})

test('getPersona 守卫：相对/绝对写法指向同一文件不误炸（resolve 归一化实证）', () => {
  resetPersonaCacheForTest()
  const asRelative = relativePath(process.cwd(), FIXTURE_TOML)
  assert.notEqual(asRelative, FIXTURE_TOML, '两种写法必须真的不同，否则这条什么也没证')
  const first = getPersona(FIXTURE_TOML)
  const second = getPersona(asRelative) // 同一个文件，另一种写法 —— 守卫不该响
  assert.equal(first, second)
  // 反向也成立：先相对后绝对同样不炸。
  resetPersonaCacheForTest()
  assert.equal(getPersona(asRelative), getPersona(FIXTURE_TOML))
})

test('getPersona 守卫：第二个 path 不同 → PersonaConfigError（不再静默给错人格）', () => {
  resetPersonaCacheForTest()
  const other = divergentToml()
  // 前提钉：第二份文件确实是**另一个**她 —— 旧行为下第二个器官会拿到 Lykoi 且无声。
  assert.equal(loadPersona(other).identity.name, 'NotLykoi')

  assert.equal(getPersona(FIXTURE_TOML).identity.name, 'Lykoi')
  assert.throws(
    () => getPersona(other),
    (exc: unknown) =>
      exc instanceof PersonaConfigError
      && exc.message === `persona TOML path conflict: process already loaded ${FIXTURE_TOML}, `
        + `refusing ${other} (one persona kernel per process, SA-156)`,
    '两器官配置分叉必须启动即炸，且 message 两个 path 都在（人话可排障）',
  )
  // 炸归炸，进程既有内核不受影响（守卫在装载之前就拦，缓存原样）。
  assert.equal(getPersona(FIXTURE_TOML).identity.name, 'Lykoi')
})

test('getPersona 守卫：失败装载不占坑（坏 path 先抛，好 path 后仍装得上）', () => {
  resetPersonaCacheForTest()
  const missing = join(mkdtempSync(join(tmpdir(), 'lykoi-persona-toml-')), 'absent.toml')
  assert.throws(
    () => getPersona(missing),
    (exc: unknown) =>
      exc instanceof PersonaConfigError && exc.message === `persona TOML not found: ${missing}`,
    '坏 path 的姿态与 loadPersona 逐字相同（不包不吞）',
  )
  // 坑没被占：好 path 走的是**首次装载**分支，而不是撞上 path conflict 守卫。
  const persona = getPersona(FIXTURE_TOML)
  assert.deepEqual(persona, FIXTURE_PERSONA)
  assert.equal(getPersona(FIXTURE_TOML), persona)
})
