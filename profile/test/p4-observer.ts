/** Acceptance-only capture of synthetic model input/output; never installed in production. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'lykoi-llm'
export const name = 'p4-model-observer'
export const inject = ['lykoiLlm']
export function apply(ctx: Context) {
  const call = ctx.lykoiLlm.call.bind(ctx.lykoiLlm)
  ctx.lykoiLlm.call = async (...args) => {
    console.log(JSON.stringify({ type: 'p4/model_input', input: args[0], metadata: args[1] }))
    const result = await call(...args)
    console.log(JSON.stringify({ type: 'p4/model_output', text: result.text, usage: result.usage }))
    return result
  }
  ctx.effect(() => () => { ctx.lykoiLlm.call = call }, 'acceptance model capture')
}
