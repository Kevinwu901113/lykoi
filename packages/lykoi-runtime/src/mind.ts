import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CharacterMind, MindEvent, MindRecord, MindPatch, MindView } from 'lykoi-contracts'

export class MindPatchError extends Error {
  readonly code: 'invalid_patch' | 'invalid_record' | 'missing_evidence' | 'revision_conflict' | 'unseen_event'
  constructor(code: MindPatchError['code'], message: string) {
    super(message)
    this.name = 'MindPatchError'
    this.code = code
  }
}

/** Only semantic rejections are observations. Storage faults must still fail the run. */
export function commitMind(mind: CharacterMind, patch: unknown, source: string, seen: MindView): string | null {
  try { mind.commit(patch, source, seen); return null }
  catch (error) {
    if (!(error instanceof MindPatchError)) throw error
    return error.code
  }
}

export const MIND_REJECTION_NOTE = '本步 Mind 更新未提交，附带的回复或动作也尚未执行。请依据当前工作集修正；必要时先 mind.read，或省略不需要的 Mind 更新。不要声称已保存。拒绝原因：'

export const MIND_PROTOCOL = `共享持续心智。可在返回 JSON 顶层加入 mind：
{"records":[{"id":"已有 ID 或新的稳定名字","kind":"thought|preference","topic":"原问题或偏好维度","understanding":"当前理解/进展","open":"这个原问题仍缺什么证据或还有什么没完成；全部解决才填 null","evidence":["来源引用"],"links":["task/skill ID"],"reconsiderAt":null,"basis":"explicit|inferred","scope":"适用情境"}],"acknowledge":["已理解事件的原始 ID"],"continue":false}
records 是完整的语义内容，所有示例字段都要提供。open 只接受非空字符串或 null；reconsiderAt 是 ISO 时间或 null；evidence 必须有来源。
不要输出 revision、status、updatedAt：它们是运行时的只读元数据，版本由本次实际读取的快照控制，不由你递增或猜测。现有记录必须先出现在共享工作集；历史记录用 mind.read 搜索后再修改。
open 是原问题的未决事项，也是结束的唯一依据。获得方法、完成对照研究、Task 完成，都不等于原问题已有结论：原对象仍缺证据就保留 open，不能以其他案例代替。只有整个 topic 已有依据地解决才填 null；局部成果写 understanding，新的不同问题另建记录。已确定的 preference 仍持续适用，不因 open=null 而失效。
thought 是自己的问题，preference 是对用户的理解，两者不能混淆。只保存可续接的结论，不保存原始思维链。没有进展可不写。此通道取代旧 inner.thoughts/resolve。
明确反馈只修订被纠正的内容、时机或表达维度，保留来源和适用范围；推断用 inferred。没有回复不表示认可、反感或关系变化。
Task 的结果是证据，先核对原问题再更新理解。事件仅在实际理解后用原始 ID acknowledge；记录更新和事件确认同事务提交。自主发现可静默吸收，用户承诺的交付仍由 Task 完成。
若还有可推进的纯思考可 continue:true；也可等待新证据或设 reconsiderAt。思考不会授权外部行动。`

/** Refresh explicitly searched records in the next model snapshot, without shared session state. */
export function mindWorkingView(mind: CharacterMind, reads: ReadonlyMap<string, number>): MindView {
  const view = mind.view()
  const records = new Map(view.records.map(record => [record.id, record]))
  for (const [query, limit] of reads) for (const record of mind.view(query, limit).records) records.set(record.id, record)
  return { records: [...records.values()], events: view.events }
}

/** One instance process owns this DB; commits are short and never contain model/network waits. */
export class MindStore implements CharacterMind {
  readonly db: DatabaseSync
  readonly now: () => Date
  constructor(path: string, now: () => Date = () => new Date()) {
    this.now = now
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS mind_records(id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mind_events(id TEXT PRIMARY KEY, document TEXT NOT NULL, handled_at TEXT);
      CREATE TABLE IF NOT EXISTS mind_commits(id TEXT PRIMARY KEY, source TEXT NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL);`)
    if (!this.db.prepare("SELECT id FROM mind_commits WHERE id='mind-content-v2'").get()) {
      const now = this.now().toISOString()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const row of this.db.prepare('SELECT id, document FROM mind_records').all()) {
          const record = JSON.parse(String(row.document)) as MindRecord
          record.open = record.status === 'released' ? null : record.open?.trim() || (record.status === 'open' || record.status === 'waiting' ? record.topic : null)
          record.status = record.status === 'released' ? 'released' : record.open === null ? 'resolved' : record.reconsiderAt ? 'waiting' : 'open'
          record.revision++
          this.db.prepare('UPDATE mind_records SET document=? WHERE id=?').run(JSON.stringify(record), row.id)
        }
        this.db.prepare('INSERT INTO mind_commits VALUES(?,?,?,?)').run('mind-content-v2', 'migration', '{}', now)
        this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    }
  }
  migrate(memoryPath: string) {
    if (this.db.prepare("SELECT id FROM mind_commits WHERE id='legacy-thoughts'").get()) return
    const memory = new DatabaseSync(memoryPath, { readOnly: true })
    try {
      if (!memory.prepare("SELECT name FROM sqlite_master WHERE name='thoughts'").get()) return
      const now = this.now().toISOString()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const row of memory.prepare("SELECT * FROM thoughts WHERE status='open'").all()) {
          const record: MindRecord = { id: `legacy-thought-${row.id}`, revision: 1, kind: 'thought', topic: String(row.content),
            understanding: String(row.content), open: String(row.content), evidence: [`memory:thought:${row.id}`], links: row.related_concern_id ? [`concern:${row.related_concern_id}`] : [],
            status: 'open', reconsiderAt: null, basis: 'inferred', scope: 'legacy thought', updatedAt: now }
          this.db.prepare('INSERT OR IGNORE INTO mind_records VALUES(?,?)').run(record.id, JSON.stringify(record))
        }
        this.db.prepare('INSERT INTO mind_commits VALUES(?,?,?,?)').run('legacy-thoughts', 'migration', '{}', now)
        this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    } finally { memory.close() }
  }
  close() { this.db.close() }
  receive(event: MindEvent) {
    this.db.prepare('INSERT OR IGNORE INTO mind_events VALUES(?,?,NULL)').run(event.id, JSON.stringify(event))
  }
  view(query = '', limit = 20): MindView {
    const now = this.now().toISOString(), needle = query.toLocaleLowerCase()
    const events = this.db.prepare('SELECT document FROM mind_events WHERE handled_at IS NULL ORDER BY rowid LIMIT ?').all(limit).map(r => JSON.parse(String(r.document)) as MindEvent)
    const related = (r: MindRecord) => events.some(e => e.reference === r.id || r.links.includes(e.reference))
    const records = this.db.prepare('SELECT document FROM mind_records').all().map(r => JSON.parse(String(r.document)) as MindRecord)
      .filter(r => query ? JSON.stringify(r).toLocaleLowerCase().includes(needle) : r.status !== 'released')
      .sort((a,b) => Number(related(b)) - Number(related(a)) || Number(b.open !== null || b.kind === 'preference') - Number(a.open !== null || a.kind === 'preference') || Number(!!b.reconsiderAt && b.reconsiderAt <= now) - Number(!!a.reconsiderAt && a.reconsiderAt <= now) || b.updatedAt.localeCompare(a.updatedAt))
    return { records: records.slice(0, limit), events }
  }
  context() { return MIND_PROTOCOL + '\n' + JSON.stringify(this.view()) }
  commit(raw: unknown, source: string, seen: MindView) {
    if (raw === undefined) return
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MindPatchError('invalid_patch', 'mind must be an object')
    const patch = raw as MindPatch
    if ((patch.records !== undefined && !Array.isArray(patch.records)) || (patch.acknowledge !== undefined && !Array.isArray(patch.acknowledge))) throw new MindPatchError('invalid_patch', 'invalid mind patch')
    const now = this.now().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of patch.records ?? []) {
        if (!record || typeof record.id !== 'string' || !record.id.trim()
          || !['thought','preference'].includes(record.kind)
          || !['explicit','inferred'].includes(record.basis) || !Array.isArray(record.evidence) || !record.evidence.every(x => typeof x === 'string')
          || !Array.isArray(record.links) || !record.links.every(x => typeof x === 'string')
          || ['topic','understanding','scope'].some(k => typeof (record as unknown as Record<string,unknown>)[k] !== 'string')
          || (record.open !== null && (typeof record.open !== 'string' || !record.open.trim()))
          || (record.reconsiderAt !== null && !Number.isFinite(Date.parse(record.reconsiderAt)))) throw new MindPatchError('invalid_record', 'invalid mind record')
        if (!record.evidence.length) throw new MindPatchError('missing_evidence', 'mind record requires evidence references')
        const row = this.db.prepare('SELECT document FROM mind_records WHERE id=?').get(record.id)
        const previous = row ? JSON.parse(String(row.document)) as MindRecord : null
        const expected = seen.records.find(r => r.id === record.id)?.revision ?? 0
        if ((previous?.revision ?? 0) !== expected) throw new MindPatchError('revision_conflict', 'mind revision conflict')
        this.db.prepare('INSERT OR REPLACE INTO mind_records VALUES(?,?)').run(record.id, JSON.stringify({ id: record.id, kind: record.kind, topic: record.topic, understanding: record.understanding, open: record.open, evidence: record.evidence, links: record.links, reconsiderAt: record.reconsiderAt === null ? null : new Date(record.reconsiderAt).toISOString(), basis: record.basis, scope: record.scope, revision: expected + 1, status: record.open === null ? 'resolved' : record.reconsiderAt ? 'waiting' : 'open', updatedAt: now }))
      }
      for (const id of patch.acknowledge ?? []) {
        if (!seen.events.some(e => e.id === id)) throw new MindPatchError('unseen_event', 'cannot acknowledge an unseen event')
        this.db.prepare('UPDATE mind_events SET handled_at=? WHERE id=? AND handled_at IS NULL').run(now, id)
      }
      this.db.prepare('INSERT INTO mind_commits VALUES(?,?,?,?)').run(randomUUID(), source, JSON.stringify(patch), now)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
