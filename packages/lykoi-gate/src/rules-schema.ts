/**
 * approval_rules 结构 schema —— **门这一份**（SK-72：孪生双拷贝是结构要求）。
 *
 * 正本：startup_verify.py `_rules_schema_problems`（活体注释逐字：
 * "structural schema for the approval rules document (stdlib twin of
 * kernel.approval.validate_rules — this copy lives in the root domain)"）。
 *
 * **为什么必须抄一份而不是 import `lykoi-kernel` 的 `validateRules`：**
 * 门的工作是判断「业务侧那棵树有没有被换掉」。如果门靠 import 业务侧的函数来
 * 判断，那么换掉那棵树的人同时也换掉了判官 —— 篡改者写一个恒返回 `[]` 的
 * `validateRules`，门就永远说一切正常。孪生双拷贝不是冗余，是**判官与被判者
 * 分离**。活体靠「stdlib-only + root:root 444」达成，新体靠「本文件在 root 属主
 * 域 + 零业务 import」达成。
 *
 * 两份必须同义（不是同字节：一份 Python 一份 TS）。同义性由
 * `test/rules-schema-twin.test.ts` 用同一批输入双跑对拍钉死 —— 那条测试是
 * **孪生对面**本身，任一份漂了它就红。
 *
 * 本文件 import 的东西：**无**。
 */

const KEYS = ['always_allow', 'always_deny', 'ask'] as const

/**
 * 结构问题清单（空 = 合格）。字段序与措辞对齐活体，便于两份逐条对拍。
 */
export function rulesSchemaProblems(rules: unknown): string[] {
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    return ['approval_rules schema: document must be a JSON object']
  }
  const problems: string[] = []
  const doc = rules as Record<string, unknown>

  const checkStrList = (block: Record<string, unknown>, key: string, where: string): void => {
    const value = block[key] ?? []
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      problems.push(`approval_rules schema: ${where}${key} must be a list of strings`)
    }
  }

  for (const key of KEYS) checkStrList(doc, key, '')
  const extra = Object.keys(doc)
    .filter((k) => !(KEYS as readonly string[]).includes(k) && k !== 'autonomous')
    .sort()
  if (extra.length > 0) {
    problems.push(`approval_rules schema: unknown top-level keys ${JSON.stringify(extra)}`)
  }

  const block = doc.autonomous
  if (block !== undefined && block !== null) {
    if (typeof block !== 'object' || Array.isArray(block)) {
      problems.push('approval_rules schema: autonomous block must be an object')
    } else {
      const b = block as Record<string, unknown>
      for (const key of ['always_allow', 'always_deny']) checkStrList(b, key, 'autonomous.')
      const blockExtra = Object.keys(b)
        .filter((k) => k !== 'always_allow' && k !== 'always_deny')
        .sort()
      if (blockExtra.length > 0) {
        problems.push(`approval_rules schema: unknown autonomous keys ${JSON.stringify(blockExtra)}`)
      }
    }
  }
  return problems
}
