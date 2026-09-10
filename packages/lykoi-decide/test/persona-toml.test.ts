import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPersona, parseTomlSubset, PersonaConfigError,
} from '../src/index.ts'
import { FIXTURE_PERSONA, FIXTURE_PERSONA_TOML } from './persona-fixture.ts'

const FIXTURE_TOML = FIXTURE_PERSONA_TOML

function tmpToml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-persona-toml-'))
  const path = join(dir, 'p.toml')
  writeFileSync(path, content, 'utf8')
  return path
}

test('合成值守卫：夹具是合成测试实例包（name=Fixture / partner=Owner / embodiment=test VM），正文零第一实例事实', () => {
  assert.deepEqual(loadPersona(FIXTURE_TOML), FIXTURE_PERSONA)
  assert.equal(FIXTURE_PERSONA.identity.name, 'Fixture')
  assert.equal(FIXTURE_PERSONA.relationship.partner, 'Owner')
  assert.equal(FIXTURE_PERSONA.voice.address_owner, 'Owner')
  assert.equal(FIXTURE_PERSONA.identity.embodiment, 'test VM')
  // 正文（去掉注释行）里出现的英文专名只许是这三个；数字一个都不许有（无主机编号/日期）。
  const body = readFileSync(FIXTURE_TOML, 'utf8').split('\n').filter((line) => !line.startsWith('#')).join('\n')
  assert.deepEqual([...new Set(body.match(/[A-Z][A-Za-z]+/g))].sort(), ['Fixture', 'Owner', 'VM'])
  assert.equal(/[0-9]/.test(body), false)
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

test('persona reads are independent across instance definitions', () => {
  const text = readFileSync(FIXTURE_TOML, 'utf8')
  const other = tmpToml(text.replace(`name = "${FIXTURE_PERSONA.identity.name}"`, 'name = "Other"'))
  assert.equal(loadPersona(FIXTURE_TOML).identity.name, FIXTURE_PERSONA.identity.name)
  assert.equal(loadPersona(other).identity.name, 'Other')
  assert.equal(loadPersona(FIXTURE_TOML).identity.name, FIXTURE_PERSONA.identity.name)
})
