/**
 * Lykoi Cordis 启动入口 — M1 骨架。
 *
 * loader 用法学 WO-M0-DSH-STUDY §2：Loader(baseUrl) + Include(path) 拉起
 * cordis.yml 的直排 entry 树；timer 作为树内首个 entry（蓝图：loader+include+timer）。
 *
 * 平时 `npm start` 常驻运行；`LYKOI_M1_SMOKE=1 npm start` 跑 M1 波次 1 验收序列
 * （心跳在跳、每拍落 audit 行、budget 红测）后退出——
 * stdout 即 var/first-run.log 的内容。
 */
import { Context, Logger } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { BudgetExceeded } from 'lykoi-budget'
import type { HeartService } from 'lykoi-heart'
import type { LykoiLlmService } from 'lykoi-llm'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const root = new Context()

// cordis 默认 logger 只进内存 buffer；接一个 stdout exporter 才看得见。
const stdoutExporter = {
  colors: 0,
  export(message: Parameters<typeof Logger.format>[1]) {
    console.log(Logger.format(stdoutExporter, message))
  },
}
root.logger.exporter(stdoutExporter)

// baseUrl 供 loader 解析相对模块名、include 解析 cordis.yml 路径。
// 注意：Loader 只把 config.baseUrl 写到它自己的 tree ctx（loader/src/index.ts:80），
// Include 的 ctx 链看不到，所以根上必须直接置位。
root.baseUrl = import.meta.url
await root.plugin(Loader, { baseUrl: import.meta.url })
await root.plugin(Include, { path: './cordis.yml', enableLogs: true })
await root.loader.await()
// 树起立证据：五个服务位全部在位（entries 挂在 Include 子树，loader 根树本身无行）。
const expectedServices = ['audit', 'budget', 'heart', 'llm', 'lykoiLlm'] as const
const roster = expectedServices.map((n) => `${n}=${root.get(n) ? 'ok' : 'MISSING'}`).join(' ')
console.log(`[lykoi] plugin tree up; services: ${roster}`)
if (roster.includes('MISSING')) {
  console.error('[lykoi] FAIL: service roster incomplete')
  process.exit(1)
}

if (process.env.LYKOI_M1_SMOKE === '1') {
  // ===== M1 波次 1 验收序列（蓝图「波次 1」：验收 = 测试全绿 + 一次真实起跑日志）=====
  const heart = root.get('heart') as HeartService
  const llm = root.get('lykoiLlm') as LykoiLlmService

  // 证据①：心跳在跳（heart/beat 事件逐拍打点）。
  root.on('heart/beat', (p) => {
    console.log(`[smoke] heart/beat pending=${p.pending} source=${p.source} at=${p.at}`)
  })

  // 证据③：budget 红测——mock 路由 50 tokens/日，每次 34 tokens，第三次必被拒。
  const runId = `first-run-${new Date().toISOString()}`
  let allowed = 0
  let refused = false
  for (let i = 1; i <= 5 && !refused; i++) {
    try {
      const result = await llm.call({
        provider: 'mock',
        model: 'mock-model',
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: `first-run smoke call #${i}` }],
            source: { kind: 'user' },
          }),
        ],
      }, { runId })
      allowed += 1
      console.log(
        `[smoke] llm call #${i} allowed: "${result.text}" `
        + `usage=${result.usage?.inputTokens}+${result.usage?.outputTokens}`,
      )
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err
      refused = true
      console.log(`[smoke] llm call #${i} REFUSED by budget gate: ${err.message}`)
    }
  }
  if (!refused) {
    console.error('[smoke] FAIL: budget hard cap never refused')
    process.exit(1)
  }
  console.log(`[smoke] budget red test PASS (${allowed} calls allowed, then hard-cap refusal)`)

  // 等 ≥3 拍，验证 tick 合并 claim。
  await sleep(3500)
  const { beats } = heart.claim()
  console.log(`[smoke] heart.claim() merged beats=${beats}`)
  if (beats < 3) {
    console.error('[smoke] FAIL: heartbeat not beating')
    process.exit(1)
  }

  // 证据②：每拍落 audit 行（heart/beat 行 + budget/charge + budget/refusal）。
  await sleep(100) // 让在途 audit 写落盘
  const auditLines = readFileSync('var/audit.jsonl', 'utf8').split('\n').filter((l) => l)
  const beatLines = auditLines.filter((l) => l.includes('"type":"heart/beat"'))
  const budgetLines = auditLines.filter((l) => l.includes('"type":"budget/'))
  console.log(
    `[smoke] audit: ${auditLines.length} lines total, `
    + `${beatLines.length} heart/beat, ${budgetLines.length} budget/*`,
  )
  console.log('[smoke] audit tail:')
  for (const line of auditLines.slice(-4)) console.log(`[smoke]   ${line}`)
  if (beatLines.length < 3 || budgetLines.length < 2) {
    console.error('[smoke] FAIL: audit evidence incomplete')
    process.exit(1)
  }

  console.log('[smoke] M1 wave-1 first run complete: heartbeat beating, every beat audited, budget hard cap enforced')
  process.exit(0)
} else {
  console.log('[lykoi] running (baseline heartbeat active); Ctrl-C to stop')
}
