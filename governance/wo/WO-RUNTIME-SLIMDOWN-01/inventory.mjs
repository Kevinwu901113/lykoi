// Run from the repository root. Static evidence only; counts are review leads.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const legacy = /\b(?:WO-[A-Z0-9-]+|SA-\d+|GK-\d+)|Python|python|移植|逐字|对拍/
const defense = /fallback|retry|demot|clamp|floor|hard.?prune/i
const packages = fs.readdirSync('packages').sort()
const summary = []
const edges = new Map()
function files(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const p = path.join(dir, entry.name)
    return entry.isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  }).sort()
}
for (const pkg of packages) {
  const sources = files(`packages/${pkg}/src`)
  const row = { package: pkg, sourceFiles: sources.length, lines: 0, legacyComments: 0, catches: 0, defenseIdentifiers: 0 }
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8')
    row.lines += text.trimEnd().split('\n').length
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    // The scanner is used only for comment leads; AST handles dependencies/catches.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
        && legacy.test(scanner.getTokenText())) row.legacyComments++
    }
    function visit(node) {
      if (ts.isCatchClause(node)) row.catches++
      if (ts.isIdentifier(node) && defense.test(node.text)) row.defenseIdentifiers++
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text
        const target = specifier.split('/')[0]
        if (target.startsWith('lykoi-') && target !== pkg) {
          const clause = ts.isImportDeclaration(node) ? node.importClause : undefined
          const typeOnly = ts.isImportDeclaration(node)
            ? !!clause && (clause.isTypeOnly || (!clause.name && clause.namedBindings
              && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0
              && clause.namedBindings.elements.every(e => e.isTypeOnly)))
            : node.isTypeOnly
          const key = `${pkg} -> ${target}`
          const edge = edges.get(key) ?? { from: pkg, to: target, value: [], typeOnly: [] }
          edge[typeOnly ? 'typeOnly' : 'value'].push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`)
          edges.set(key, edge)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  if (sources.length) summary.push(row)
}
console.log(JSON.stringify({
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  method: 'Static source inventory; value edges include mixed imports. Comments and defensive names are leads, not semantic verdicts. Dynamic imports, runtime registration and profile ordering require manual inspection.',
  packages: summary,
  edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
}, null, 2))
