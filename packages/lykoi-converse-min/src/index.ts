/**
 * lykoi-converse-min — 最小对话环（M1 波次 2 交付④）。
 *
 * ⚠ 定位（工单原文）：本环是 **M1 管线证明，非心智**。她的心智——装配器 + 决策信封
 * （S-23..S-53，十二块装配、demote 护栏、内向念头）——是 M2 的 lykoi-decide；
 * 此处提示词只用占位（一条裸 user 消息），不做任何装配、不注入任何 state。
 *
 * 链路（工单④）：适配器盖章的入站 → 本环 → lykoiLlm.call（route 可配：mock 或
 * 交付①的剥头 adapter）→ 适配器 send（reply_to=入站 message_id，SPEC §7.1）。
 * 每步落 audit 行；budget 有账（lykoiLlm.call 的结构保证：gate 前置、charge 后置）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from 'lykoi-llm'
import type { InboundMessage, TelegramAdapterService } from 'lykoi-adapter-telegram'

export const name = 'lykoi-converse-min'
// audit/lykoiLlm 硬依赖；telegram 经 ctx.get 可选消费（dsh 形态：可选 seam 用
// ctx.get 表达——profile 里 telegram 默认 disabled 时本环照常挂载、安静待命）。
export const inject = ['audit', 'lykoiLlm']

export interface Config {
  /** LLM 路由（budget 同词汇）：mock（M1 profile 默认）或 deepseek-official（交付①）。 */
  route: string
  model: string
}

export const Config: Schema<Config> = Schema.object({
  route: Schema.string().default('mock'),
  model: Schema.string().default('mock-model'),
})

export function apply(ctx: Context, config: Config) {
  ctx.on('lykoi/telegram/inbound', async (message) => {
    await handleTurn(ctx, config, message)
  })
}

async function handleTurn(ctx: Context, config: Config, message: InboundMessage): Promise<void> {
  // 隐私口径：audit 行只带字数与来源盖章，不带正文。
  await ctx.audit.record({
    type: 'converse/received',
    updateId: message.updateId,
    contextId: message.contextId,
    userId: message.userId,
    isOwner: message.isOwner,
    chars: message.text.length,
  })
  // S-08：普通对话级对全部**已绑定**发送者开放（绑定闸在适配器；owner-only 的
  // 前两级路由——审批回答/规则建议回答——是 M3 的事，这里只留顺序位）。

  // run 归因（budget.charge 的 runId 口径）：一回合一个 run。
  const runId = `converse-${message.updateId}-${message.messageId}`
  let replyText: string
  try {
    const result = await ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      messages: [
        // 占位提示词（非心智）：M2 的 lykoi-decide 在此处换成装配器 + 信封契约。
        createUserMessage({
          content: [{ type: 'text', text: message.text }],
          source: { kind: 'user' },
        }),
      ],
    }, { runId })
    replyText = result.text
    await ctx.audit.record({
      type: 'converse/reply',
      runId,
      updateId: message.updateId,
      chars: replyText.length,
      ...(result.finish === undefined ? {} : { finish: result.finish.kind }),
    })
  } catch (err) {
    // 失败方向 = 空回合（SPEC §1.1 T4：/chat 任何失败 → empty turn，不崩轮询；
    // BudgetExceeded 也走此路——拒调已由 budget 落过审计）。
    await ctx.audit.record({
      type: 'converse/turn_failed',
      runId,
      updateId: message.updateId,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return
  }

  if (replyText.trim().length === 0) {
    // 空回复是合法结局（S-10 注）：不发、留痕。
    await ctx.audit.record({ type: 'converse/silence', runId, updateId: message.updateId })
    return
  }

  const telegram = ctx.get('telegram') as TelegramAdapterService | undefined
  if (telegram === undefined) {
    // profile 里 telegram 默认 disabled：有话说不出去也要留痕（管线可观测）。
    await ctx.audit.record({ type: 'converse/no_transport', runId, updateId: message.updateId })
    return
  }
  // S-10 顺序位：先说话……（reply_to=入站 message_id，SPEC §7.1 应答路径）
  await telegram.send(message.contextId, replyText, message.messageId)
  // ……后请示：审批问句的顺序位。本波无审批（M3 在此位接 approval ask 的委托路），
  // 刻意留空不留 stub 调用——蓝图纪律 2：不发明审批机制。
}
