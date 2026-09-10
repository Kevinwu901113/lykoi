/** Acceptance-only replacement organ: file.read replaces workspace.read, with the same filesystem implementation. */
import type { Context } from '@deepseek-ai/cordis'
import { workspaceCapabilities } from 'lykoi-organ-workspace'
import { join } from 'node:path'
export const name = 'p4-alternate-files'
export const inject = ['lykoiRuntime']
export async function apply(ctx: Context) {
  const instance = ctx.lykoiRuntime.instance!
  const base = await workspaceCapabilities(join(instance.stateRoot, 'workspace'))
  const capabilities = base.filter(c => c.name !== 'terminal.exec').map(c => ({ ...c, name: c.name === 'workspace.read' ? 'file.read' : c.name,
    handler: async (p: Record<string, unknown>, execution?: import('lykoi-contracts').CapabilityExecutionContext) => {
      if (execution && execution.instanceId !== instance.id) throw new Error('wrong instance')
      const current = execution ? (await workspaceCapabilities(execution.workspace)).find(x => x.name === c.name)! : c
      return current.handler(p, execution)
    },
  }))
  ctx.effect(() => ctx.lykoiRuntime.register({ organId: 'alternate-files', capabilities, sideEffects: [] }), 'alternate filesystem')
}
