/**
 * 读侧卫生与预算估算（shared/dsml.py 的 strip 半面 + shared/tokens.py；
 * S-32 / S-30 的支撑件）。
 *
 * DSML：探测只认全角竖线双写标记 ``｜｜DSML｜｜``（U+FF5C×2）——正常中文、
 * 英文、代码、甚至谈论 XML/DSML 的文本都打不出这个序列，误伤面为零
 * （dsml.py:14-17）。新体对话路径生而信封、无工具循环转录 —— **救回半面
 * （parse_tool_calls）不迁**：它服务的 DSML 泄漏只发生在 tools-API 转录机上；
 * 迁的只有卫生半面 strip_markup —— 库里已落的机器标记不许经回灌/召回重回
 * 上下文（S-32）。
 *
 * tokens：crude-but-safe 高估（CJK ≈ 1 token/字，其余 ≈ 4 字/token，每消息
 * +8 开销）—— 预算检查宁可早裁一点，也不放一个超限载荷去被 provider 拒。
 */

// --- DSML strip（dsml.py:33-44 逐字对应） -------------------------------------

const MARK = '｜｜DSML｜｜'
export const TOOL_CALLS_OPEN = '<｜｜DSML｜｜tool_calls>'
// 块可能被 max_tokens 截断在半途 —— 没有闭合标签时吃到文本末尾，残块也不外泄。
const BLOCK_RE = /<｜｜DSML｜｜tool_calls>[\s\S]*?(?:<\/｜｜DSML｜｜tool_calls>|$)/g
const TAG_RE = /<\/?｜｜DSML｜｜[^>\n]*>/g

export function containsMarkup(text: string): boolean {
  return text.includes(MARK)
}

/** 剥掉全部 DSML 块与残留标签（卫生层兜底）—— 机器标记任何情况不出对话口。 */
export function stripMarkup(text: string): string {
  return text.replace(BLOCK_RE, '').replace(TAG_RE, '').trim()
}

// --- token 估算（tokens.py 逐字对应） -----------------------------------------

/** 每消息协议开销（role 标签、分隔符）—— 小常量（tokens.py:14）。 */
export const MESSAGE_OVERHEAD_TOKENS = 8

const CJK_RANGES: readonly [number, number][] = [
  [0x4E00, 0x9FFF], //  CJK Unified Ideographs
  [0x3400, 0x4DBF], //  CJK Extension A
  [0x3000, 0x303F], //  CJK punctuation
  [0xFF00, 0xFFEF], //  full-width forms
  [0x30A0, 0x30FF], //  Katakana
  [0x3040, 0x309F], //  Hiragana
  [0xAC00, 0xD7AF], //  Hangul
]

function isCjk(cp: number): boolean {
  return CJK_RANGES.some(([lo, hi]) => lo <= cp && cp <= hi)
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let total = 0
  for (const ch of text) {
    total += 1
    if (isCjk(ch.codePointAt(0)!)) cjk += 1
  }
  const other = total - cjk
  return cjk + Math.floor((other + 3) / 4)
}

/** 与 tokens.py:_message_text 同形：content 串 / null 空 / 容器序列化 + tool_calls。 */
function messageText(message: Record<string, unknown>): string {
  const content = message.content
  let text: string
  if (typeof content === 'string') text = content
  else if (content === null || content === undefined) text = ''
  else text = JSON.stringify(content)
  const calls = message.tool_calls
  if (calls) text += JSON.stringify(calls)
  return text
}

export function estimateMessagesTokens(messages: readonly Record<string, unknown>[]): number {
  return messages.reduce(
    (sum, m) => sum + estimateTokens(messageText(m)) + MESSAGE_OVERHEAD_TOKENS,
    0,
  )
}

// --- 时刻渲染（conversation.py:449-459 _beijing_stamp 对应） -------------------

/** 她和 Kevin 都生活在北京时间（conversation.py:58）。 */
export const BEIJING_OFFSET_MS = 8 * 3_600_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 一个 ISO 时刻 → 北京时间的 ``MM-DD HH:MM``。坏时间戳原样带过 —— 编一个时刻
 * 比显示一个丑字符串坏得多。未送达账本与相关记忆共用它：两个块并排出现在
 * 易变尾部，时刻写法不一致会让她把同一天看成两天。
 */
export function beijingStamp(raw: string): string {
  // Python fromisoformat 域的宽容对应：ISO 形态解析失败 → 原样。
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw + 'Z' // naive → UTC
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return raw
  const bj = new Date(ms + BEIJING_OFFSET_MS)
  return `${pad2(bj.getUTCMonth() + 1)}-${pad2(bj.getUTCDate())} ${pad2(bj.getUTCHours())}:${pad2(bj.getUTCMinutes())}`
}

/** 北京时间的 `YYYY-MM-DD HH:MM` + 周几序号（Python weekday()：周一=0）。 */
export function beijingClock(now: Date): { stamp: string; weekday: number } {
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS)
  const stamp = `${bj.getUTCFullYear()}-${pad2(bj.getUTCMonth() + 1)}-${pad2(bj.getUTCDate())}`
    + ` ${pad2(bj.getUTCHours())}:${pad2(bj.getUTCMinutes())}`
  return { stamp, weekday: (bj.getUTCDay() + 6) % 7 }
}

// --- 小工具 -------------------------------------------------------------------

/** Python 切片语义（码点）。 */
export function cpSlice(text: string, limit: number): string {
  const cps = [...text]
  return cps.length <= limit ? text : cps.slice(0, limit).join('')
}

/** Python `" ".join(s.split())`：折叠全部空白成单空格。 */
export function collapseWs(text: string): string {
  return text.split(/\s+/).filter((s) => s.length > 0).join(' ')
}

/** Python f-string 对 float 的形态（round 后整值仍带 .0）。 */
export function pyFloatStr(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x)
}

/** Python f-string 对任意值（None → 'None'、True/False 首字母大写）。 */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}
