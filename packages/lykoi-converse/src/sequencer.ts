import type { OutboundReplyOutcome } from 'lykoi-adapter-telegram'

/** 同一轮逐条等待；失败即停，不改字、不重试成功前缀。 */
export async function sequenceUtterances(
  parts: readonly string[],
  send: (text: string, index: number) => Promise<OutboundReplyOutcome>,
): Promise<{ outcome: OutboundReplyOutcome; delivered: number; total: number }> {
  let delivered = 0
  for (const [index, text] of parts.entries()) {
    let outcome: OutboundReplyOutcome
    try { outcome = await send(text, index) }
    catch { outcome = 'undelivered' }
    if (outcome !== 'delivered') return { outcome, delivered, total: parts.length }
    delivered++
  }
  return { outcome: 'delivered', delivered, total: parts.length }
}
