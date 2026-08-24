/**
 * L3 · 相关性检索（SA-109..116）。检索域/打分逐字/确定性/退化行为/通配符两道保险/零写入。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieveForConcern } from '../src/l3.ts'
import {
  T0, changedTables, makeStore, minutesAfter, rawOpen, scopeExperience, seedExperience,
  tableDigests,
} from './fixture.ts'

test('SA-109 检索域=全部 experiences：working∪archive、integrated 0∪1、水位线上下都在内', () => {
  const { store, path } = makeStore()
  try {
    const eWorking = seedExperience(store, 'conversation', '聊了睡眠质量', T0)
    const eArchive = seedExperience(store, 'action_result', '查询睡眠质量返回 ok', minutesAfter(T0, 1)) // ≤80 → archive
    const eIntegrated = seedExperience(store, 'conversation', '早前也聊过睡眠质量', minutesAfter(T0, 2))
    store.markExperiencesIntegrated([eIntegrated], 7, { now: minutesAfter(T0, 3) })
    // 水位线抬到顶：intake 队列全空，但检索域不受水位线影响。
    const db = rawOpen(path)
    try {
      db.prepare("UPDATE learning_layer_state SET value = 9999 WHERE key = 'l2_intake_watermark_id'").run()
    } finally {
      db.close()
    }
    assert.deepEqual(store.intakePending(10, true), [])

    const hits = retrieveForConcern(store, { title: '睡眠质量', description: '' })
    assert.deepEqual(hits.map((h) => h.id).sort(), [eWorking, eArchive, eIntegrated].sort())
    // experience_class 随行带出（缺行时 null 的口径由 LEFT JOIN 保证）。
    assert.equal(hits.find((h) => h.id === eArchive)!.experience_class, 'archive')
  } finally {
    store.close()
  }
})

test('SA-112 相邻链 2c−1 超线性 + SA-110 字段权重：原短语 > 孤立 bigram；标题 1.5 > 描述 1.0', () => {
  const { store } = makeStore()
  try {
    const full = seedExperience(store, 'conversation', '最近睡眠质量不太好', T0) //         链 c=3 → 5 分
    const partial = seedExperience(store, 'conversation', '交付质量还行', minutesAfter(T0, 1)) // 孤立 bigram → 1 分
    const hits = retrieveForConcern(store, { title: '睡眠质量', description: '' })
    assert.deepEqual(hits.map((h) => h.id), [full, partial])
    // 标题权重 1.5：链 5×1.5=7.5；孤立 1×1.5=1.5。
    assert.equal(hits[0]!.relevance_score, 7.5)
    assert.equal(hits[1]!.relevance_score, 1.5)
    // SA-113：命中理由是还原的原文片段（不是词项 id / "matched"）。
    assert.deepEqual(hits[0]!.match_reasons, ['keyword:睡眠质量@title'])
    assert.deepEqual(hits[1]!.match_reasons, ['keyword:质量@title'])

    // 同词项出现在描述 → 权重 1.0。
    const viaDesc = retrieveForConcern(store, { title: '', description: '睡眠质量' })
    assert.equal(viaDesc[0]!.relevance_score, 5.0)
    assert.equal(viaDesc[0]!.match_reasons[0], 'keyword:睡眠质量@description')
  } finally {
    store.close()
  }
})

test('ASCII 词：整词子串 2.0×权重、大小写/全角折叠；停用词与单字符不成词项；功能字 bigram 丢弃', () => {
  const { store } = makeStore()
  try {
    const hit = seedExperience(store, 'conversation', '和 KEVIN 讨论了 cordis', T0)
    seedExperience(store, 'conversation', '无关内容', minutesAfter(T0, 1))
    // 全角查询词 NFKC 折半角；内容大小写不敏感。
    const hits = retrieveForConcern(store, { title: 'ｋｅｖｉｎ', description: '' })
    assert.deepEqual(hits.map((h) => h.id), [hit])
    assert.equal(hits[0]!.relevance_score, 3.0) // 2.0 × 1.5
    assert.deepEqual(hits[0]!.match_reasons, ['keyword:kevin@title'])

    // 纯停用词/单字符标题 → 无词项 → []（不退化成"最近 N 条"，SA-115）。
    assert.deepEqual(retrieveForConcern(store, { title: 'the a 的了', description: '' }), [])
  } finally {
    store.close()
  }
})

test('SA-114 确定性：同分按 id 倒序（新的在前）；limit 截断；limit<0 抛', () => {
  const { store } = makeStore()
  try {
    const a = seedExperience(store, 'conversation', '穿搭灵感一', T0)
    const b = seedExperience(store, 'conversation', '穿搭灵感二', minutesAfter(T0, 1))
    const probe = { title: '穿搭', description: '' }
    const hits = retrieveForConcern(store, probe)
    assert.deepEqual(hits.map((h) => h.id), [b, a]) // 同分 → id DESC
    assert.deepEqual(retrieveForConcern(store, probe, { limit: 1 }).map((h) => h.id), [b])
    assert.deepEqual(retrieveForConcern(store, probe, { limit: 0 }), [])
    assert.throws(() => retrieveForConcern(store, probe, { limit: -1 }), /limit must be >= 0/)
  } finally {
    store.close()
  }
})

test('实体轴硬过滤 + SA-115 退化：某人的关切不召回另一个人的原料；无词项时有实体=这个人的全部', () => {
  const { store, path } = makeStore()
  try {
    const mine = seedExperience(store, 'conversation', '他的睡眠情况', T0)
    const other = seedExperience(store, 'conversation', '别人的睡眠情况', minutesAfter(T0, 1))
    const unscoped = seedExperience(store, 'conversation', '睡眠但无作用域', minutesAfter(T0, 2))
    const db = rawOpen(path)
    try {
      db.prepare("INSERT INTO users (id, display_name, role, created_at) VALUES ('user_002','x','group_member','2026-08-09T00:00:00+00:00')").run()
    } finally {
      db.close()
    }
    scopeExperience(path, mine, 'user_001')
    scopeExperience(path, other, 'user_002')

    const scoped = retrieveForConcern(store, { title: '睡眠', description: '', subject_user_id: 'user_001' })
    assert.deepEqual(scoped.map((h) => h.id), [mine])
    // 实体命中加分 + entity 理由（分数自洽）。
    assert.equal(scoped[0]!.relevance_score, 1.5 + 1.0)
    assert.deepEqual(scoped[0]!.match_reasons, ['keyword:睡眠@title', 'entity:subject_user_id=user_001'])

    // SA-115：榨不出词项 + 有实体 → 这个人的全部经验；无实体 → []。
    const fallback = retrieveForConcern(store, { title: '%%%', description: '', subject_user_id: 'user_001' })
    assert.deepEqual(fallback.map((h) => h.id), [mine])
    assert.deepEqual(retrieveForConcern(store, { title: '%%%', description: '' }), [])
    void unscoped
  } finally {
    store.close()
  }
})

test('SA-116 通配符两道保险：% / _ 是分隔符永不进词项；LIKE ESCAPE 把残余词项按字面比对', () => {
  const { store } = makeStore()
  try {
    const plain = seedExperience(store, 'conversation', '100on 特价与 abc 无关', T0)
    const literal = seedExperience(store, 'conversation', '内容真含 a%b 字样', minutesAfter(T0, 1))
    // 第一道：'a%b' 切段成 'a'（单字符弃）与 'b'（单字符弃）→ 无词项 → []。
    assert.deepEqual(retrieveForConcern(store, { title: 'a%b', description: '' }), [])
    // '100%on'：% 是分隔符 → 词项 '100'/'on'——不会变成 LIKE '100%on' 的通配，
    // 只有真含 '100'/'on' 子串的行入选（a%b 那行不入）。
    const hits = retrieveForConcern(store, { title: '100%on', description: '' })
    assert.deepEqual(hits.map((h) => h.id), [plain])
    // 第二道（store 直测）：预筛词项若真含 %，按字面转义只中字面行。
    const rows = store.relevanceCandidateRows({ terms: ['a%b'], subjectUserId: null, since: null, until: null })
    assert.deepEqual(rows.map((r) => r.id), [literal])
  } finally {
    store.close()
  }
})

test('时间轴闭区间 + 模块零写入（逐表 sha 全等）', () => {
  const { store, path } = makeStore()
  try {
    const early = seedExperience(store, 'conversation', '早的睡眠记录', T0)
    const late = seedExperience(store, 'conversation', '晚的睡眠记录', minutesAfter(T0, 10))
    const sinceTs = minutesAfter(T0, 5).toISOString().replace('.000Z', '+00:00')
    const before = tableDigests(path)
    const hits = retrieveForConcern(store, { title: '睡眠', description: '' }, { since: sinceTs })
    assert.deepEqual(hits.map((h) => h.id), [late])
    const both = retrieveForConcern(store, { title: '睡眠', description: '' })
    assert.equal(both.length, 2)
    // 零写入：两次检索后全库逐表摘要逐字节未动。
    assert.deepEqual(changedTables(before, tableDigests(path)), [])
    void early
  } finally {
    store.close()
  }
})
