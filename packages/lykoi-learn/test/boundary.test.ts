/**
 * 边界静态钉死（学 heart 的 G-2 零依赖钉法）：
 *  - SA-137/SA-82：L4 的安全边界（不碰调节场/叙事/messenger）；
 *  - SA-141：L5 铁律（零审批 import、零 write_standing、零规则文件写）；
 *  - SA-176：settleThought 调用点全仓唯一（红线 #3 静态绊线，W1 TODO 销账）；
 *  - 包 import 面：learn src 只许 lykoi-regulation + 包内文件；
 *  - 词汇/格式副本与 lykoi-memory 导出的逐字相等（shared 里为守 import 面持副本）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LINEAGE_PRODUCT_CONCERN, LINEAGE_PRODUCT_INSIGHT, LINEAGE_PRODUCT_SUGGESTION,
  LINEAGE_SOURCE_CONCERN, LINEAGE_SOURCE_EXPERIENCE, LINEAGE_SOURCE_INSIGHT,
  pyIso,
} from '../src/shared.ts'
import * as rw from 'lykoi-memory/rw'

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))
const PACKAGES_DIR = fileURLToPath(new URL('../..', import.meta.url))

function srcFile(name: string): string {
  return readFileSync(join(SRC_DIR, name), 'utf8')
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
}

/** 粗剥注释（块注释 + 行尾 //）——铁律扫描只看代码面，注释里可以谈论审批。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
}

test('包 import 面：learn src 只 import lykoi-regulation 与包内文件（store 全走结构化接口）', () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'))
  assert.ok(files.length >= 6)
  for (const file of files) {
    for (const spec of importSpecifiers(srcFile(file))) {
      assert.ok(spec === 'lykoi-regulation' || spec.startsWith('./'),
        `${file}: 越界 import '${spec}'（learn 的 store 面只能是注入的结构化接口）`)
    }
  }
})

test('SA-137/SA-82：l4/l5 源码零 applyRegulationCause、零 addNarrativeVersion、零 releaseConcern、零 messenger', () => {
  for (const file of ['l4.ts', 'l5.ts', 'l3.ts', 'l1.ts']) {
    const code = stripComments(srcFile(file))
    for (const forbidden of ['applyRegulationCause', 'addNarrativeVersion', 'releaseConcern', 'messenger', 'telegram']) {
      assert.ok(!code.includes(forbidden), `${file}: 不得触碰 ${forbidden}（层 2 安全边界）`)
    }
  }
})

test('SA-141 铁律：l5（与全包 src）零审批 import、零 write_standing、零 approval_rules 写', () => {
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const raw = srcFile(file)
    for (const spec of importSpecifiers(raw)) {
      assert.ok(!/approval/i.test(spec), `${file}: import '${spec}' 触到审批件`)
    }
    const code = stripComments(raw)
    assert.ok(!/write_standing|writeStanding/.test(code), `${file}: write_standing 出现于代码面`)
    assert.ok(!code.includes('approval_rules'), `${file}: approval_rules 出现于代码面`)
    // 入队侧不许持任何文件系统写口（连 fs 都不 import——写只经注入的 store 接口）。
    assert.ok(!/node:fs/.test(raw), `${file}: 不得 import node:fs`)
  }
  // lykoi-memory/rw 的建议队列节同样受铁律约束（store 层代码面零审批引用）。
  const rwCode = stripComments(readFileSync(join(PACKAGES_DIR, 'lykoi-memory/src/rw.ts'), 'utf8'))
  assert.ok(!rwCode.includes('approval_rules'), 'rw.ts: approval_rules 出现于代码面')
  assert.ok(!/write_standing|writeStanding/.test(rwCode), 'rw.ts: write_standing 出现于代码面')
})

test('SA-176 静态绊线：全仓 packages/*/src 内 `.settleThought(` 调用点唯 lykoi-learn/src/l2.ts', () => {
  const offenders: string[] = []
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, pkg, 'src')
    let entries: string[]
    try {
      entries = readdirSync(src)
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(src, entry)
      if (!statSync(full).isFile() || !entry.endsWith('.ts')) continue
      const code = stripComments(readFileSync(full, 'utf8'))
      if (code.includes('.settleThought(')) {
        offenders.push(`${pkg}/src/${entry}`)
      }
    }
  }
  assert.deepEqual(offenders, ['lykoi-learn/src/l2.ts'],
    '仅整合路径可写 absorbed（红线 #3）——出现了第二个 settleThought 调用点')
})

test('副本对拍：shared 的血缘词汇与 pyIso 格式与 lykoi-memory 导出逐字相等（守 import 面的代价有测试兜底）', () => {
  assert.equal(LINEAGE_PRODUCT_INSIGHT, rw.LINEAGE_PRODUCT_INSIGHT)
  assert.equal(LINEAGE_PRODUCT_CONCERN, rw.LINEAGE_PRODUCT_CONCERN)
  assert.equal(LINEAGE_PRODUCT_SUGGESTION, rw.LINEAGE_PRODUCT_SUGGESTION)
  assert.equal(LINEAGE_SOURCE_EXPERIENCE, rw.LINEAGE_SOURCE_EXPERIENCE)
  assert.equal(LINEAGE_SOURCE_CONCERN, rw.LINEAGE_SOURCE_CONCERN)
  assert.equal(LINEAGE_SOURCE_INSIGHT, rw.LINEAGE_SOURCE_INSIGHT)
  for (const d of [
    new Date('2026-08-24T10:00:00Z'),
    new Date('2026-08-24T10:00:00.007Z'),
    new Date('2026-12-31T23:59:59.999Z'),
  ]) {
    assert.equal(pyIso(d), rw.formatPyIso(d))
  }
})

test('kind 枚举同源：l5 三常量 ⊆ rw.RULE_SUGGESTION_KINDS（_V14 CHECK 的代码面）', async () => {
  const l5 = await import('../src/l5.ts')
  assert.deepEqual(
    [l5.KIND_CONCERN_RELEASE, l5.KIND_PERMISSION_RULE, l5.KIND_STANDING_GRANT],
    [...rw.RULE_SUGGESTION_KINDS])
})
