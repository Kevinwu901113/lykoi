/** Test provider: returns only markers actually visible in the cognition request. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
class RecallAdapter extends LlmAdapter {
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const visible = JSON.stringify({ system: options.system, messages: options.messages })
    const found = [...new Set(visible.match(/P1_MEMORY_[AB]_[0-9]+/g) ?? [])]
    if (visible.includes('P1_WAIT')) await new Promise(resolve => setTimeout(resolve, 700))
    const fileMarker = visible.match(/P2_FILE_[AB]_[0-9]+/)?.[0]
    const fileDecision = fileMarker
      ? { kind: 'reply', content: fileMarker, reason: 'continuity' }
      : { kind: 'tool_call', tool: { name: 'workspace.read', arguments: { path: 'note.txt' } }, reason: 'continuity' }
    const text = JSON.stringify({ meaning_assessment: [{ item: 'continuity', meaning: 'recall', pull: 0.6 }],
      decision: visible.includes('P2_READ') ? fileDecision : { kind: 'reply', content: found.length ? found.join(' ') : 'no marker', reason: 'continuity' } })
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export const inject = ['llm']
export function apply(ctx: Context) { ctx.llm.registerAdapter(['continuity'], new RecallAdapter()) }
