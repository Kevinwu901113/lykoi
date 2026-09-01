/**
 * persona TOML 装载面（cognition/config.py 的 load_persona/get_persona 对应物；
 * SA-156；W5 身份收口）。
 *
 * 装载失败姿态逐字（config.py:113-124）：文件缺失 →
 * `persona TOML not found: {target}`；解析失败 →
 * `persona TOML is not valid TOML: {exc}`；字段校验交给 parsePersonaData
 * （五 section 严格校验，缺失/类型错即 PersonaConfigError）。fail-fast：
 * 一个坏内核必须在启动时炸，而不是被静默默认值糊过去。
 *
 * TOML 解析器：Node 24 无内建 tomllib，蓝图钉版纪律不为此引第三方依赖 ——
 * 实现一个**严格的 TOML 子集**解析器，覆盖 persona 内核 schema 的全部形态
 * （[section] 表头、bare key、基本/字面字符串、布尔、整数/浮点、字符串数组、
 * 注释）。子集之外的合法 TOML 构造（内联表、点号键、日期等）一律**大声拒绝**
 * 进 "not valid TOML" 姿态 —— 方向与 fail-fast 相同：宁可启动时炸，不静默
 * 读歪。新体形态适配，报告留痕。
 *
 * 进程级缓存（get_persona 对应物）：首次装载后缓存，改 TOML 需重启 ——
 * 与模块级 prompt 常量同一契约（SA-156）。缓存带 **path 一致性守卫**
 * （D-CP-2，WO-CACHE-PERSONA）：两个器官若配置分叉，第二个必须启动即炸，
 * 而不是静默拿到第一个器官的人格。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PersonaConfigError, parsePersonaData, type PersonaConfig } from './persona.ts'

// ============================== TOML 子集解析 ==============================

class TomlSubsetError extends Error {}

/** 去掉行内注释（尊重字符串边界；基本字符串内的 \\ 转义不终结字符串）。 */
function stripComment(line: string): string {
  let inBasic = false
  let inLiteral = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!
    if (inBasic) {
      if (ch === '\\') i += 1
      else if (ch === '"') inBasic = false
    } else if (inLiteral) {
      if (ch === "'") inLiteral = false
    } else if (ch === '"') {
      inBasic = true
    } else if (ch === "'") {
      inLiteral = true
    } else if (ch === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

const BASIC_ESCAPES: Record<string, string> = {
  b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\',
}

function parseBasicString(text: string): { value: string; rest: string } {
  // text 以 `"` 开头。
  let out = ''
  let i = 1
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '"') return { value: out, rest: text.slice(i + 1) }
    if (ch === '\\') {
      const esc = text[i + 1]
      if (esc === undefined) break
      if (esc === 'u' || esc === 'U') {
        const width = esc === 'u' ? 4 : 8
        const hex = text.slice(i + 2, i + 2 + width)
        if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
          throw new TomlSubsetError(`invalid \\${esc} escape`)
        }
        out += String.fromCodePoint(Number.parseInt(hex, 16))
        i += 2 + width
        continue
      }
      const mapped = BASIC_ESCAPES[esc]
      if (mapped === undefined) throw new TomlSubsetError(`invalid escape \\${esc}`)
      out += mapped
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  throw new TomlSubsetError('unterminated basic string')
}

function parseLiteralString(text: string): { value: string; rest: string } {
  const end = text.indexOf("'", 1)
  if (end === -1) throw new TomlSubsetError('unterminated literal string')
  return { value: text.slice(1, end), rest: text.slice(end + 1) }
}

/** 解析一个值（含数组递归）；返回值与剩余文本。 */
function parseValue(text: string): { value: unknown; rest: string } {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('"')) return parseBasicString(trimmed)
  if (trimmed.startsWith("'")) return parseLiteralString(trimmed)
  if (trimmed.startsWith('[')) {
    const items: unknown[] = []
    let rest = trimmed.slice(1)
    for (;;) {
      rest = rest.replace(/^[\s,]+/, '')
      if (rest.startsWith(']')) return { value: items, rest: rest.slice(1) }
      if (rest === '') throw new TomlSubsetError('unterminated array')
      const parsed = parseValue(rest)
      items.push(parsed.value)
      rest = parsed.rest
    }
  }
  const scalar = /^[^\s,\]]+/.exec(trimmed)
  if (scalar === null) throw new TomlSubsetError('empty value')
  const token = scalar[0]
  const rest = trimmed.slice(token.length)
  if (token === 'true') return { value: true, rest }
  if (token === 'false') return { value: false, rest }
  if (/^[+-]?\d+$/.test(token)) return { value: Number.parseInt(token, 10), rest }
  if (/^[+-]?(\d+\.\d+|\.\d+|\d+\.)$/.test(token)) return { value: Number.parseFloat(token), rest }
  throw new TomlSubsetError(`unsupported TOML construct: ${token}`)
}

/**
 * 严格 TOML 子集 → 顶层 table。子集外构造（点号键、内联表、[[array-of-tables]]、
 * 日期时间等）一律抛 —— 上层折进 "not valid TOML" 姿态。
 */
export function parseTomlSubset(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let current = root
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n += 1) {
    const stripped = stripComment(lines[n]!).trim()
    if (stripped === '') continue
    if (stripped.startsWith('[')) {
      const match = /^\[([A-Za-z0-9_-]+)\]$/.exec(stripped)
      if (match === null) {
        throw new TomlSubsetError(`unsupported table header at line ${n + 1}: ${stripped}`)
      }
      const name = match[1]!
      if (Object.hasOwn(root, name)) throw new TomlSubsetError(`duplicate table [${name}]`)
      current = {}
      root[name] = current
      continue
    }
    const eq = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(stripped)
    if (eq === null) throw new TomlSubsetError(`cannot parse line ${n + 1}: ${stripped}`)
    const key = eq[1]!
    if (Object.hasOwn(current, key)) throw new TomlSubsetError(`duplicate key ${key}`)
    let valueText = eq[2]!
    // 数组可跨行：拼接后续行直到能完整解析。
    let parsed: { value: unknown; rest: string } | null = null
    for (;;) {
      try {
        parsed = parseValue(valueText)
        break
      } catch (exc) {
        if (
          exc instanceof TomlSubsetError
          && /unterminated/.test(exc.message)
          && n + 1 < lines.length
        ) {
          n += 1
          valueText += '\n' + stripComment(lines[n]!)
          continue
        }
        throw exc
      }
    }
    if (parsed.rest.trim() !== '') {
      throw new TomlSubsetError(`trailing content after value at line ${n + 1}`)
    }
    current[key] = parsed.value
  }
  return root
}

// ============================== 装载 + 缓存（SA-156） ==============================

/**
 * 读 + 校验 persona TOML，返回校验过的 PersonaConfig（load_persona 对应物）。
 * 不缓存 —— 生产走 getPersona；测试直接调这里练 fail-fast 各路径。
 */
export function loadPersona(path: string): PersonaConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new PersonaConfigError(`persona TOML not found: ${path}`)
  }
  let data: Record<string, unknown>
  try {
    data = parseTomlSubset(text)
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc)
    throw new PersonaConfigError(`persona TOML is not valid TOML: ${message}`)
  }
  return parsePersonaData(data)
}

let cached: PersonaConfig | null = null
let cachedPath: string | null = null

/**
 * 进程级 persona 内核（get_persona 对应物）：首次装载后缓存 —— 改 TOML 需
 * 重启，与模块级 prompt 常量同一契约。活体的 path 是模块常量；新体由插件配置
 * 传入，同样**每进程恰一个**（SA-156）。
 *
 * **path 一致性守卫（D-CP-2）**：首次**成功**装载时记录归一化 path（resolve
 * 后）；后续调用若 path 归一化后不同 → 抛 PersonaConfigError。曾经的姿态是
 * 「首个调用点 path 生效、后续静默忽略」——那意味着两器官配置一旦分叉，第二个
 * 器官会拿到**错的人格且无声**；SA-156「每进程恰一份内核」只靠「文件恰好没变」
 * 这个偶然事实撑着。守卫把静默错人格换成启动即炸。
 *
 * 只有**成功装载**才落缓存与首 path：装载失败不占坑 —— 一次坏 path 不会把
 * 整个进程的内核位锁死，负例测试也不会毒化后续顺序。
 */
export function getPersona(path: string): PersonaConfig {
  const normalized = resolve(path)
  if (cached === null) {
    // 先装载后落坑：loadPersona 抛出时 cached/cachedPath 原样为 null。
    const loaded = loadPersona(normalized)
    cached = loaded
    cachedPath = normalized
    return loaded
  }
  if (cachedPath !== normalized) {
    throw new PersonaConfigError(
      `persona TOML path conflict: process already loaded ${cachedPath}, `
      + `refusing ${normalized} (one persona kernel per process, SA-156)`,
    )
  }
  return cached
}

/**
 * **测试专用**清缓存（D-CP-3，WO-CACHE-PERSONA）：生产代码路径零调用 ——
 * 缓存在生产不可清除是 SA-156「每进程恰一份内核」的一部分。存在的唯一理由是
 * 让守卫的各条用例各自从干净起点出发（否则四条用例互相顺序耦合，「失败不占坑」
 * 那条更是会在缓存已热时测到别的东西）。
 */
export function resetPersonaCacheForTest(): void {
  cached = null
  cachedPath = null
}
