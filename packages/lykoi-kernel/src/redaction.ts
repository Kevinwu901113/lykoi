const _SUFFIXES = ['_API_KEY', '_SECRET', '_PASSWORD'] as const
const _MIN_LEN = 6
const _PLACEHOLDER = '[REDACTED]'

function collectSecrets(): ReadonlySet<string> {
  const values = new Set<string>()
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= _MIN_LEN && _SUFFIXES.some((s) => name.endsWith(s))) {
      values.add(value)
    }
  }
  return values
}

let _SECRETS: ReadonlySet<string> = collectSecrets()

export function _setSecretsForTest(values: readonly string[] | null): void {
  _SECRETS = values === null ? collectSecrets() : new Set(values)
}

export function redact(text: string): string {
  if (typeof text !== 'string') return text
  let out = text
  for (const secret of _SECRETS) {
    if (out.includes(secret)) out = out.split(secret).join(_PLACEHOLDER)
  }
  return out
}

/** 递归遮蔽 dict/list/标量里的每一个字符串（键也遮；撞键加 #n 后缀保值）。 */
export function redactObj(obj: unknown): unknown {
  if (typeof obj === 'string') return redact(obj)
  if (Array.isArray(obj)) return obj.map((value) => redactObj(value))
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      const safeKey = redact(key)
      let candidate = safeKey
      let suffix = 2
      while (candidate in result) {
        // 两个原键遮蔽后同名时保全每个值；后缀不含键的任何素材。
        candidate = `${safeKey}#${suffix}`
        suffix += 1
      }
      result[candidate] = redactObj(value)
    }
    return result
  }
  return obj
}

export function assertNoSecrets(params: unknown): void {
  const blob = JSON.stringify(params, (_key, value: unknown) =>
    typeof value === 'bigint' ? String(value) : value)
  if (typeof blob !== 'string') return
  for (const secret of _SECRETS) {
    if (blob.includes(secret)) {
      throw new Error('refusing action: secret value present in params')
    }
  }
}
