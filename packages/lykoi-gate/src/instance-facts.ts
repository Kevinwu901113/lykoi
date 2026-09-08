/** Instance facts are data, not framework literals. Node-only startup check.
 * Synthetic Fixture/Owner values belong in tests/fixtures, not runtime source.
 * This is a literal regression check, not a detector for computed/obfuscated facts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// The deny-list declaration itself is the one exact, reviewed scanner exclusion.
export const INSTANCE_TOKENS = Object.freeze(['Lykoi', 'Kevin', '192.168.0.202', 'Kevinwu901113'])
export interface InstanceFactHit { file: string; line: number; token: string }
interface Literal { text: string; offset: number }

/** Lex strings and template segments, including strings inside ${...} expressions.
 * Comments and regular expressions are skipped without removing URL-like text in strings.
 */
export function sourceLiterals(source: string): Literal[] {
  const result: Literal[] = []
  let i = 0
  function quoted(quote: string): void {
    let start = ++i
    let text = ''
    while (i < source.length) {
      const c = source[i++]!
      if (c === '\\') {
        const escaped = source[i++] ?? ''
        if (escaped === 'u' || escaped === 'x') {
          const count = escaped === 'u' ? 4 : 2
          const hex = source.slice(i, i + count)
          if (new RegExp(`^[0-9a-fA-F]{${count}}$`).test(hex)) { text += String.fromCharCode(parseInt(hex, 16)); i += count }
          else text += escaped
        } else text += escaped
      } else if (c === quote) {
        result.push({ text, offset: start }); return
      } else if (quote === '`' && c === '$' && source[i] === '{') {
        result.push({ text, offset: start }); text = ''; i++; code(true); start = i
      } else text += c
    }
    result.push({ text, offset: start })
  }
  function code(nested = false): void {
    let depth = 0
    let expressionStart = true
    while (i < source.length) {
      const c = source[i]!, next = source[i + 1]
      if (/\s/.test(c)) { i++; continue }
      if (c === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue }
      if (c === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue }
      if (c === '"' || c === "'" || c === '`') { quoted(c); expressionStart = false; continue }
      if (c === '/' && expressionStart) {
        i++; let inClass = false
        while (i < source.length) {
          const r = source[i++]!
          if (r === '\\') i++
          else if (r === '[') inClass = true
          else if (r === ']') inClass = false
          else if (r === '/' && !inClass) break
          else if (r === '\n') break
        }
        expressionStart = false; continue
      }
      if (/[\w$]/.test(c)) {
        const start = i++
        while (i < source.length && /[\w$]/.test(source[i]!)) i++
        expressionStart = /^(return|throw|case|yield|await|typeof|void|delete|in|of)$/.test(source.slice(start, i))
        continue
      }
      if (c === '{') depth++
      if (c === '}') { if (nested && depth === 0) { i++; return }; depth-- }
      expressionStart = /[=(:,;!&|?{\[+*%<>~-]/.test(c)
      i++
    }
  }
  code()
  return result
}

function configLiterals(source: string): Literal[] {
  // Configuration/shell/unit values may be unquoted. # starts a comment only outside quotes.
  let offset = 0
  return source.split('\n').map((line) => {
    let quote = '', end = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '\\') { i++; continue }
      if (quote) { if (c === quote) quote = '' }
      else if (c === '"' || c === "'") quote = c
      else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) { end = i; break }
    }
    const literal = { text: line.slice(0, end), offset }
    offset += line.length + 1
    return literal
  })
}

export function scanInstanceFacts(repoRoot: string): InstanceFactHit[] {
  const files: string[] = []
  const collect = (dir: string, tsOnly: boolean): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) collect(path, tsOnly)
      else if (entry.isFile() && (!tsOnly || entry.name.endsWith('.ts'))) files.push(path)
      else if (entry.isSymbolicLink()) throw new Error(`instance_facts: symlink in scan surface: ${relative(repoRoot, path)}`)
    }
  }
  const packages = join(repoRoot, 'packages')
  if (existsSync(packages)) for (const p of readdirSync(packages)) collect(join(packages, p, 'src'), true)
  collect(join(repoRoot, 'profile'), false)
  collect(join(repoRoot, 'deploy'), false)
  const hits: InstanceFactHit[] = []
  for (const file of files) {
    const rel = relative(repoRoot, file)
    const source = readFileSync(file, 'utf8')
    const literals = file.endsWith('.ts') ? sourceLiterals(source) : configLiterals(source)
    for (const literal of literals) {
      // Exclude only the exact four declaration literals, not the scanner's whole file.
      const declaration = rel === 'packages/lykoi-gate/src/instance-facts.ts'
        && source.slice(0, literal.offset).split('\n').at(-1)?.startsWith('export const INSTANCE_TOKENS = Object.freeze([')
      if (declaration) continue
      for (const token of INSTANCE_TOKENS) {
        const at = literal.text.indexOf(token)
        if (at < 0) continue
        if (token === INSTANCE_TOKENS[0] && !/\bLykoi\b/.test(literal.text)) continue
        hits.push({ file: rel, line: source.slice(0, literal.offset).split('\n').length + literal.text.slice(0, at).split('\n').length - 1, token })
      }
    }
  }
  return hits
}
