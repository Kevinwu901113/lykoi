/**
 * 密文遮蔽（shared/redaction.py 逐字对拍；kernel/redaction.py 在活体只是它的
 * re-export —— 新体实现直接住在 kernel，因为 kernel 是最底层库模块）。
 *
 * 进程启动（模块 import）时把 env 里名字以 `_API_KEY` / `_SECRET` / `_PASSWORD`
 * 结尾的值快照成集合。任何可能携带密钥值的东西在离开进程前过
 * `redact`/`redactObj`（交回认知的 Observation、落盘的事件行）；认知想执行的
 * 东西过 `assertNoSecrets` —— 密钥值既不泄进 Observation、不落进事件流，
 * 也偷不进 Action 的 params（SK-05）。
 *
 * 短于 `_MIN_LEN` 的值忽略：空/超短凭证会把无关文本变成噪声。
 */

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

/**
 * 测试面（Python 侧以 monkeypatch 模块常量实现同一件事）：
 * null 恢复从 env 重新快照。
 */
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

/** params 里任何位置出现已知密钥值 → 抛（拒绝动作，SK-05 第一半）。 */
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
