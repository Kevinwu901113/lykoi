import type { Component, Config, Json } from './contracts.ts'
import { checkSchema, object, pathValue, validateSchema } from './values.ts'
import { validId } from './definition.ts'
import { validateQuestions, checkDecision } from './providers.ts'

function keys(c: Config, allowed: string[]) {
  if (Object.keys(c).some((key) => !allowed.includes(key)))
    throw new Error('invalid component config')
}
export function branchIds(config: Config): string[] {
  return [
    ...(config.cases as Config[]).map((c) => String(c.id)),
    String(config.default)
  ]
}
export function chooseBranch(input: Json, config: Config): string {
  for (const branch of config.cases as Config[]) {
    const pass = (branch.conditions as Config[]).every((condition) => {
      let value: Json
      try {
        value = pathValue(input, condition.path)
      } catch {
        return condition.op === 'missing'
      }
      const right = condition.value
      switch (condition.op) {
        case 'exists':
          return true
        case 'missing':
          return false
        case 'eq':
          return JSON.stringify(value) === JSON.stringify(right)
        case 'neq':
          return JSON.stringify(value) !== JSON.stringify(right)
        case 'gte':
          return (
            typeof value === 'number' &&
            typeof right === 'number' &&
            value >= right
          )
        case 'gt':
          return (
            typeof value === 'number' &&
            typeof right === 'number' &&
            value > right
          )
        case 'lte':
          return (
            typeof value === 'number' &&
            typeof right === 'number' &&
            value <= right
          )
        case 'lt':
          return (
            typeof value === 'number' &&
            typeof right === 'number' &&
            value < right
          )
        case 'contains':
          return (
            typeof value === 'string' &&
            typeof right === 'string' &&
            value.includes(right)
          )
        default:
          throw new Error('unsupported condition operator')
      }
    })
    if (pass) return String(branch.id)
  }
  return String(config.default)
}
export const flowBuiltins: Component[] = [
  {
    id: 'flow.input',
    version: '1.0.0',
    title: '开始 / 输入',
    description: '校验本次运行的结构化输入。',
    kind: 'transform',
    effect: 'pure',
    input: 'any',
    output: 'any',
    resourceRoles: {},
    defaultConfig: {
      schema: {
        type: 'object',
        properties: { task: { type: 'string' } },
        required: ['task'],
        additionalProperties: false
      }
    },
    validate(c) {
      keys(c, ['schema'])
      validateSchema(c.schema)
    },
    async invoke(input, c) {
      checkSchema(input, c.schema)
      return { status: 'completed', value: input }
    }
  },
  {
    id: 'data.transform',
    version: '1.0.0',
    title: '数据转换',
    description: '提取字段、解析 JSON；输入映射可组装对象。',
    kind: 'transform',
    effect: 'pure',
    input: 'any',
    output: 'any',
    resourceRoles: {},
    defaultConfig: { mode: 'identity' },
    validate(c) {
      keys(c, ['mode', 'path'])
      if (!['identity', 'pick', 'parse-json'].includes(String(c.mode)))
        throw new Error('invalid transform mode')
      if (
        c.mode === 'pick' &&
        (!Array.isArray(c.path) || c.path.some((p) => typeof p !== 'string'))
      )
        throw new Error('pick requires a field path')
    },
    async invoke(input, c) {
      const value =
        c.mode === 'pick'
          ? pathValue(input, c.path)
          : c.mode === 'parse-json'
            ? JSON.parse(
                typeof input === 'string'
                  ? input
                  : (() => {
                      throw new Error('parse-json requires text')
                    })()
              )
            : input
      return { status: 'completed', value }
    }
  },
  {
    id: 'flow.branch',
    version: '1.0.0',
    title: '条件分支',
    description: '按顺序判断条件；只选择一个出口，未命中走默认路线。',
    kind: 'control',
    effect: 'pure',
    input: 'any',
    output: 'any',
    resourceRoles: {},
    defaultConfig: {
      cases: [{ id: 'yes', conditions: [{ path: [], op: 'eq', value: true }] }],
      default: 'else'
    },
    validate(c) {
      keys(c, ['cases', 'default'])
      if (
        !Array.isArray(c.cases) ||
        !c.cases.length ||
        c.cases.length > 16 ||
        !validId(c.default)
      )
        throw new Error('invalid branch cases')
      for (const branch of c.cases) {
        if (
          !object(branch) ||
          !validId(branch.id) ||
          !Array.isArray(branch.conditions) ||
          !branch.conditions.length ||
          branch.conditions.length > 16
        )
          throw new Error('invalid branch condition')
        for (const condition of branch.conditions) {
          if (
            !object(condition) ||
            !Array.isArray(condition.path) ||
            condition.path.some(
              (p) =>
                typeof p !== 'string' ||
                ['constructor', '__proto__', 'prototype'].includes(p)
            ) ||
            ![
              'eq',
              'neq',
              'gt',
              'gte',
              'lt',
              'lte',
              'contains',
              'exists',
              'missing'
            ].includes(String(condition.op)) ||
            (!['exists', 'missing'].includes(String(condition.op)) &&
              condition.value === undefined)
          )
            throw new Error('invalid branch predicate')
        }
      }
      if (new Set(branchIds(c)).size !== branchIds(c).length)
        throw new Error('duplicate branch id')
    },
    async invoke(input, c) {
      return {
        status: 'completed',
        value: { branch: chooseBranch(input, c), value: input }
      }
    }
  },
  {
    id: 'flow.merge',
    version: '1.0.0',
    title: '互斥汇合',
    description: '接收唯一已执行路线的结果；多个活跃输入会报错。',
    kind: 'control',
    effect: 'pure',
    input: 'any',
    output: 'any',
    resourceRoles: {},
    defaultConfig: {},
    validate(c) {
      keys(c, [])
    },
    async invoke(input) {
      return { status: 'completed', value: input }
    }
  },
  {
    id: 'model.decision',
    version: '1.0.0',
    title: '决策计算',
    description: '调用 JEV 等决策提供者；返回类型化答案、概率与置信度。',
    kind: 'decision',
    effect: 'pure',
    input: 'any',
    output: 'any',
    resourceRoles: { model: 'model' },
    defaultConfig: {
      questions: {
        route: {
          type: 'choice',
          instructions: '选择处理任务的路线。',
          criteria: { fast: '简单问题', deep: '复杂推理问题' }
        }
      },
      onError: 'fail'
    },
    validate(c) {
      keys(c, ['questions', 'onError'])
      validateQuestions(c.questions)
      if (
        c.onError !== undefined &&
        !['fail', 'fallback'].includes(String(c.onError))
      )
        throw new Error('invalid decision failure policy')
    },
    async invoke(input, c, context) {
      const model = context.resource('model')
      if (!('decide' in model))
        throw new Error('resource is not a decision model')
      try {
        const value = await model.decide(
          input,
          c.questions as Config,
          context.signal
        )
        checkDecision(value, c.questions as Config)
        return { status: 'completed', value }
      } catch (error) {
        context.signal.throwIfAborted()
        if (c.onError !== 'fallback') throw error
        return {
          status: 'completed',
          value: { answers: {}, error: 'decision_unavailable' }
        }
      }
    }
  },
  {
    id: 'http.request',
    version: '1.0.0',
    title: 'HTTP 请求',
    description: '调用绑定服务的 JSON 接口；凭证由资源句柄提供。',
    kind: 'transform',
    effect: 'external',
    input: 'any',
    output: 'any',
    resourceRoles: { http: 'http' },
    defaultConfig: { path: '', method: 'GET' },
    validate(c) {
      keys(c, ['path', 'method'])
      if (
        typeof c.path !== 'string' ||
        !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(c.method))
      )
        throw new Error('invalid HTTP request')
    },
    async invoke(input, c, context) {
      const client = context.resource('http')
      if (!('request' in client))
        throw new Error('resource is not an HTTP service')
      return {
        status: 'completed',
        value: await client.request(
          String(c.path),
          String(c.method),
          input,
          context.signal
        )
      }
    }
  }
]
