/** Provider JSON framing and syntax-only recovery; incomplete string values are never fabricated. */
export const JSON_RETRY_NUDGE =
  '你上一次的输出是空的，或者不是一个 JSON 对象。现在只输出那一个 JSON 对象：'
  + '以 { 开始、以 } 结束，不要代码块，不要任何别的字。'

export function extractJson(content: string | null | undefined): unknown {
  const text = (content || '').trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        // fall through
      }
    }
  }
  throw new Error('invalid provider JSON')
}

export const REPAIR_CLOSERS_MAX = 4

/** 剥 ``` 围栏：首行 ```lang 与末尾 ```（末尾那道可缺 —— 截断场景正是这样）。 */
function stripFence(text: string): string {
  if (!text.startsWith('```')) return text
  const nl = text.indexOf('\n')
  let body = nl === -1 ? '' : text.slice(nl + 1)
  if (body.endsWith('```')) body = body.slice(0, -3)
  return body.trim()
}

export function repairTrailingClosers(text: string): { text: string; added: string } | null {
  const body = stripFence((text || '').trim())
  if (!body.startsWith('{')) return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of body) {
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      stack.push('}')
    } else if (ch === '[') {
      stack.push(']')
    } else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null // 错配：不是"少写了尾"
    }
  }
  if (stack.length === 0) return null // 已平衡：合法输入不动，别的坏法不归这里
  if (escaped || inString) return null // Truncated content is not recoverable syntax.
  let added = ''
  while (stack.length > 0) added += stack.pop()
  if (added.length > REPAIR_CLOSERS_MAX) return null
  const repaired = body + added
  try {
    JSON.parse(repaired)
  } catch {
    return null
  }
  return { text: repaired, added }
}
