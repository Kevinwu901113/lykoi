import { mkdir, realpath, readFile, open } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import type {
  Component,
  Config,
  Json,
  Model,
  Message,
  CoreDecision
} from './contracts.ts'
import { assertJson } from './definition.ts'
import { flowBuiltins } from './flow.ts'
import { validateSchema } from './values.ts'

const text = (input: Json) =>
  typeof input === 'string' ? input : JSON.stringify(input)
function fields(config: Config, allowed: string[], required: string[] = []) {
  if (
    Object.keys(config).some((k) => !allowed.includes(k)) ||
    required.some((k) => typeof config[k] !== 'string')
  )
    throw new Error('invalid component config')
}
async function workspacePath(root: string, name: string) {
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '..' || part === '.')
  )
    throw new Error('expected a relative workspace file')
  const base = await realpath(root),
    path = resolve(base, name)
  // Do not create a parent through a symlink before checking it. First edition uses existing subdirectories only.
  const parent = await realpath(dirname(path)),
    rel = relative(base, parent)
  if (rel.startsWith('..') || isAbsolute(rel) || parent !== dirname(path))
    throw new Error('workspace path escapes its root or uses a symlink')
  return path
}
export const builtins: Component[] = [
  {
    id: 'text.template',
    version: '1.0.0',
    title: '提示词',
    description: '用 {{input}} 注入上游内容。',
    kind: 'transform',
    effect: 'pure',
    input: 'any',
    output: 'text',
    defaultConfig: { template: '请根据以下内容给出清晰的回答：\n{{input}}' },
    resourceRoles: {},
    validate: (c) => fields(c, ['template'], ['template']),
    invoke: async (input, config, context) => ({
      status: 'completed',
      value: context.render
        ? context.render(String(config.template), input)
        : String(config.template).replaceAll('{{input}}', text(input))
    })
  },
  {
    id: 'model.core',
    version: '1.0.0',
    title: 'Core',
    description: '每次调用只计算一次；执行策略决定是否继续调用工具。',
    kind: 'core',
    effect: 'external',
    input: 'any',
    output: 'any',
    defaultConfig: { system: '你是一个严谨的助手。' },
    resourceRoles: { model: 'model' },
    validate: (c) => {
      fields(c, ['system', 'outputFormat', 'outputSchema'], ['system'])
      if (
        c.outputFormat !== undefined &&
        !['text', 'json'].includes(String(c.outputFormat))
      )
        throw new Error('invalid Core output format')
      if (c.outputSchema !== undefined) {
        validateSchema(c.outputSchema)
        if (c.outputFormat !== 'json')
          throw new Error('schema requires JSON output')
      }
    }
  },
  {
    id: 'human.wait',
    version: '1.0.0',
    title: '人工输入',
    description: '持久等待用户输入，重启后继续。',
    kind: 'wait',
    effect: 'pure',
    input: 'any',
    output: 'any',
    defaultConfig: { prompt: '请检查上游结果，输入确认后的内容以继续。' },
    resourceRoles: {},
    validate: (c) => {
      fields(c, ['prompt', 'schema'], ['prompt'])
      if (c.schema !== undefined) validateSchema(c.schema)
    },
    invoke: async (_input, c) => ({
      status: 'waiting',
      prompt: String(c.prompt)
    })
  },
  {
    id: 'output.value',
    version: '1.0.0',
    title: '输出',
    description: '交付上游值，不再调用模型。',
    kind: 'transform',
    effect: 'pure',
    input: 'any',
    output: 'any',
    defaultConfig: {},
    resourceRoles: {},
    validate: (c) => fields(c, []),
    invoke: async (input) => ({ status: 'completed', value: input })
  },
  {
    id: 'workspace.write',
    version: '1.0.0',
    title: '写入文件',
    description: '只在实例工作区内新建文件，不覆盖已有文件。',
    kind: 'tool',
    effect: 'external',
    input: 'any',
    output: 'any',
    defaultConfig: {},
    resourceRoles: { workspace: 'workspace' },
    validate: (c) => fields(c, []),
    toolSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false
    },
    invoke: async (input, _c, context) => {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        typeof input.path !== 'string' ||
        typeof input.content !== 'string' ||
        Object.keys(input).some((k) => !['path', 'content'].includes(k))
      )
        throw new Error('write requires path and content')
      if (input.content.length > 1000000)
        throw new Error('file content exceeds limit')
      const root = (context.resource('workspace') as { root: string }).root
      const path = await workspacePath(root, input.path)
      context.signal.throwIfAborted()
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      try {
        await file.writeFile(input.content)
        await file.sync()
      } finally {
        await file.close()
      }
      const hash = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
      return { status: 'completed', value: { path: input.path, sha256: hash } }
    }
  },
  {
    id: 'workspace.read',
    version: '1.0.0',
    title: '读取文件',
    description: '读取实例工作区内的文本文件。',
    kind: 'tool',
    effect: 'pure',
    input: 'any',
    output: 'text',
    defaultConfig: {},
    resourceRoles: { workspace: 'workspace' },
    validate: (c) => fields(c, []),
    toolSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    },
    invoke: async (input, _c, context) => {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        typeof input.path !== 'string' ||
        Object.keys(input).some((k) => k !== 'path')
      )
        throw new Error('read requires path')
      const path = await workspacePath(
        (context.resource('workspace') as { root: string }).root,
        input.path
      )
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if ((await file.stat()).size > 1000000)
          throw new Error('file exceeds read limit')
        return { status: 'completed', value: await file.readFile('utf8') }
      } finally {
        await file.close()
      }
    }
  },
  ...flowBuiltins
]

/** Explicit offline fixture: no fabricated research or network result. */
export const demoModel: Model = {
  async compute(messages) {
    const last = messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    return { kind: 'finish', result: `【离线演示模型】\n${last}` }
  }
}
export function compatibleModel(
  config: Config,
  credential: string | undefined,
  fetcher: typeof fetch = fetch
): Model {
  const endpoint = `${String(config.baseUrl).replace(/\/$/, '')}/chat/completions`
  return {
    async compute(messages, tools, signal, options): Promise<CoreDecision> {
      const response = await fetcher(endpoint, {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...(credential ? { authorization: `Bearer ${credential}` } : {})
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          ...(options?.json
            ? { response_format: { type: 'json_object' } }
            : {}),
          ...(tools.length
            ? {
                tools: tools.map((t) => ({ type: 'function', function: t })),
                parallel_tool_calls: false
              }
            : {})
        })
      })
      if (!response.ok)
        throw new Error(`model provider returned HTTP ${response.status}`)
      const data = (await response.json()) as any
      const message = data.choices?.[0]?.message
      if (!message) throw new Error('model provider returned no message')
      if (message.tool_calls?.length) {
        if (message.tool_calls.length !== 1)
          throw new Error(
            'parallel tool calls are not supported in this edition'
          )
        const call = message.tool_calls[0]
        if (
          typeof call.function?.name !== 'string' ||
          typeof call.function.arguments !== 'string' ||
          typeof call.id !== 'string'
        )
          throw new Error('invalid tool call')
        const input = JSON.parse(call.function.arguments)
        assertJson(input)
        return {
          kind: 'act',
          action: { tool: call.function.name, input, callId: call.id }
        }
      }
      if (typeof message.content !== 'string')
        throw new Error('model provider returned no text')
      return { kind: 'finish', result: message.content }
    }
  }
}
export async function ensureWorkspace(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  return { root: await realpath(root) }
}
export function coreMessages(system: string, input: Json): Message[] {
  return [
    { role: 'system', content: system },
    { role: 'user', content: text(input) }
  ]
}
