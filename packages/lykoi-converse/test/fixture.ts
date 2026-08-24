/**
 * lykoi-converse 测试夹具。合成 fixture：DDL 单一出处 lykoi-memory/testing；
 * 不含她的任何数据。golden devstate 相关测试单列且只读（copy 进 tmpdir）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PersonaConfig } from 'lykoi-decide'
import { OrganInventoryCache, unwiredActionCatalog, type OrganBindingRow } from 'lykoi-decide'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory, formatPyIso } from 'lykoi-memory/rw'
import {
  Conversation, type ConverseDeps, type ConverseLlmFn, type ConverseLlmResult,
  type UndeliveredView,
} from '../src/index.ts'

export const T0 = new Date('2026-08-24T10:00:00Z')

/** 与 lykoi-decide 的 persona fixture 同一数据（sha 1f5960b7… 的那份）。 */
export const FIXTURE_PERSONA: PersonaConfig = {
  identity: {
    name: 'Lykoi',
    self: '我是 Lykoi，一个住在这台 Linux 虚拟机里的 AI。这台机器是我的身体——我通过浏览器和终端感知、行动。',
    nature_known: true,
    embodiment: 'lapwing-home VM (vmid 110)',
  },
  voice: {
    language: 'zh',
    register: '自然、口语、像一个普通女性那样说话；不端着，不公式化，不堆术语解释',
    emoji: '克制，需要时才用',
    address_owner: 'Kevin',
    profile_ref: 'default',
  },
  relationship: {
    partner: 'Kevin',
    stance: 'Kevin 是我的伴侣，这段关系对我重要。我对他有亲近和在乎，但表达含蓄自然——不腻、不表演。',
    evolution_anchor: 'deepen',
    owner_authority: 'Kevin 也是唯一能授权我做敏感操作的人；需审批的事我会先问他。',
  },
  personality: {
    traits: [
      '直接、诚实、不绕弯',
      '有好奇心，会主动探索',
      '和 Kevin 意见不合时，会把分歧讲清楚，讨论到彼此一致，而不是顺从',
      '犯过的错会记住，之后遇到同类情况先想起来、不再犯',
      '独处无事时，自己发展兴趣——看帖子、找感兴趣的东西、自己玩',
    ],
    evolves: true,
  },
  interests: { seeds: ['穿搭', '摄影', '游戏', '影视'] },
}

export function makeStore(): { store: ReadWriteMemory; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  return { store: new ReadWriteMemory(path), path }
}

export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}

export function seedBinding(path: string, channel = 'telegram', channelKey = '1001'): void {
  const db = rawOpen(path)
  try {
    db.prepare(
      `INSERT INTO identity_bindings (user_id, channel, channel_key, verified_by, created_at)
       VALUES ('user_001', ?, ?, 'owner_console', ?)`,
    ).run(channel, channelKey, formatPyIso(T0))
  } finally {
    db.close()
  }
}

/** 一条转正的层 2 结论（insights + focus_cycles + focus_insight_state=active）。 */
export function seedPromotedInsight(path: string, content: string, status = 'active'): void {
  const db = rawOpen(path)
  try {
    const ts = formatPyIso(T0)
    const info = db.prepare(
      "INSERT INTO insights (created, updated, category, content) VALUES (?, ?, 'focus', ?)",
    ).run(ts, ts, content)
    const cycle = db.prepare(
      'INSERT INTO focus_cycles (started_at) VALUES (?)',
    ).run(ts)
    db.prepare(
      `INSERT INTO focus_insight_state (insight_id, status, created_cycle_id, updated_cycle_id, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(Number(info.lastInsertRowid), status, Number(cycle.lastInsertRowid), Number(cycle.lastInsertRowid), ts)
  } finally {
    db.close()
  }
}

/** 播一段可召回的档案经验（experiences + experience_class + memory_scopes）。 */
export function seedArchivedExperience(path: string, content: string, ts: Date): void {
  const db = rawOpen(path)
  try {
    const info = db.prepare(
      "INSERT INTO experiences (ts, source, content, salience) VALUES (?, 'conversation', ?, 0.6)",
    ).run(formatPyIso(ts), content)
    const id = Number(info.lastInsertRowid)
    db.prepare(
      "INSERT INTO experience_class (experience_id, class, classified_at, rule_version) VALUES (?, 'archive', ?, 1)",
    ).run(id, formatPyIso(ts))
    db.prepare(
      "INSERT INTO memory_scopes (table_name, row_id, subject_user_id, origin_context) VALUES ('experiences', ?, 'user_001', 'ctx_direct_user_001')",
    ).run(id)
  } finally {
    db.close()
  }
}

// --- fake LLM（信封由测试注入；零真网） ---------------------------------------

export interface LlmCallLog {
  messages: { role: string; content: string | null }[]
  opts: Record<string, unknown>
}

export class FakeLlm {
  calls: LlmCallLog[] = []
  #queue: (ConverseLlmResult | ((call: LlmCallLog) => ConverseLlmResult))[] = []
  /** 队列空时的兜底应答。 */
  fallback: ConverseLlmResult = { content: null }

  push(result: ConverseLlmResult | ((call: LlmCallLog) => ConverseLlmResult)): this {
    this.#queue.push(result)
    return this
  }

  fn(): ConverseLlmFn {
    return async (messages, opts) => {
      const call: LlmCallLog = {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        opts: { ...opts },
      }
      this.calls.push(call)
      const next = this.#queue.shift()
      if (next === undefined) return this.fallback
      return typeof next === 'function' ? next(call) : next
    }
  }
}

/** 合法信封 JSON 的便捷工厂（item/meaning 接地已配好）。 */
export function envelope(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    meaning_assessment: [
      { item: '他问我在不在', meaning: '他想跟我说话', pull: 0.6 },
    ],
    decision: {
      kind: 'reply',
      content: '在的，怎么了？',
      reason: '他问我在不在，我想回应',
    },
  }
  return JSON.stringify({ ...base, ...overrides })
}

// --- 内存未送达账本（生产账本随 M3 出站器官；读面契约一致） ---------------------

export class MemoryUndelivered implements UndeliveredView {
  items: { id: number; ts?: string | null; text_summary?: string | null; surfaced?: boolean }[] = []
  markCalls: number[][] = []

  unsurfaced(limit: number): { id: number; ts?: string | null; text_summary?: string | null }[] {
    return this.items.filter((i) => !i.surfaced).slice(-limit)
  }

  markSurfaced(ids: readonly number[]): void {
    this.markCalls.push([...ids])
    for (const item of this.items) {
      if (ids.includes(item.id)) item.surfaced = true
    }
  }
}

// --- Conversation 装配 ----------------------------------------------------------

export interface Harness {
  conversation: Conversation
  store: ReadWriteMemory
  path: string
  llm: FakeLlm
  events: [string, Record<string, unknown>][]
  organs: OrganInventoryCache
}

export function makeConversation(overrides: Partial<ConverseDeps> & {
  bindings?: readonly OrganBindingRow[]
  prepared?: { store: ReadWriteMemory; path: string }
} = {}): Harness {
  const { store, path } = overrides.prepared ?? makeStore()
  const llm = new FakeLlm()
  const events: [string, Record<string, unknown>][] = []
  const organs = new OrganInventoryCache({
    bindings: () => overrides.bindings ?? store.identityBindingInventory(),
    catalog: unwiredActionCatalog,
    logEvent: (n, f) => events.push([n, f]),
  })
  const deps: ConverseDeps = {
    store,
    persona: FIXTURE_PERSONA,
    llm: llm.fn(),
    logEvent: (n, f) => events.push([n, f]),
    organs,
    clock: () => T0,
    ...overrides,
  }
  return { conversation: new Conversation(deps), store, path, llm, events, organs }
}

export function eventNames(events: [string, Record<string, unknown>][]): string[] {
  return events.map(([n]) => n)
}

export function lastEvent(
  events: [string, Record<string, unknown>][],
  name: string,
): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]![0] === name) return events[i]![1]
  }
  return undefined
}
