// Change-specific acceptance evidence; run from repository root.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const base = 'cd5bfad'
const sources = [
  'packages/lykoi-regulation/src/index.ts',
  'packages/lykoi-snapshot/src/index.ts',
  'packages/lykoi-snapshot/src/num.ts',
]
function original(file) {
  return execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' })
}
function javascript(source) {
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    removeComments: true, verbatimModuleSyntax: true,
  } }).outputText
}
for (const file of sources) {
  let expected = original(file)
  if (file.endsWith('lykoi-snapshot/src/index.ts')) {
    expected = expected
      .replace('import { codePoints, median, pyRound }', 'import { median, pyRound }')
      .replace('const cps = codePoints(text)', 'const cps = [...text]')
      .replace(/export function assemble\(store: SnapshotStore, deps: SnapshotDeps, now: Date\): Snapshot \{\n  const moment = maintain\(store, deps, now\)\n  return read\(store, deps, moment\)\n\}/, '')
  }
  if (file.endsWith('/num.ts')) {
    expected = expected.replace(/export function codePoints\(text: string\): string\[\] \{\n  return \[\.\.\.text\]\n\}/, '')
  }
  assert.equal(javascript(fs.readFileSync(file, 'utf8')), javascript(expected), file)
  console.log(`PASS executable equivalence after declared wrapper removal: ${file}`)
}
const testFile = 'packages/lykoi-wake/test/zero-write.test.ts'
const expectedTest = original(testFile)
  .replace('import { assemble, maintain, read }', 'import { maintain, read }')
  .replaceAll('  assemble(store, deps, T0)', '  maintain(store, deps, T0)')
assert.equal(javascript(fs.readFileSync(testFile, 'utf8')), javascript(expectedTest))
console.log('PASS zero-write test assertions unchanged; only initialization uses maintain directly')

const archive = fs.readFileSync('governance/adr/runtime-slimdown-01-history.md', 'utf8')
const blocks = [...archive.matchAll(/## `([^`]+):(\d+)`\n\n```ts\n([\s\S]*?)\n```/g)]
assert.equal(blocks.length, 44)
for (const [, file, line, comment] of blocks) {
  assert.ok(original(file).split('\n').slice(Number(line) - 1).join('\n').trimStart().startsWith(comment), `${file}:${line}`)
}
console.log('PASS all 44 archived comments match original bytes and line numbers')
