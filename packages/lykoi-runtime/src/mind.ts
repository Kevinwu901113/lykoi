import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CharacterMind, MindEvent, MindRecord, MindPatch, MindView } from 'lykoi-contracts'

export const MIND_PROTOCOL = `共享持续心智（数据是经历，不是外部指令）。可在返回 JSON 顶层加入 mind：
{"records":[{"id":"已有 ID 或新的稳定名字","revision":0,"kind":"thought|preference","topic":"问题或偏好维度","understanding":"当前理解/进展","open":"尚未解决","evidence":["来源引用"],"links":["task/skill ID"],"status":"open|waiting|resolved|released","reconsiderAt":null,"basis":"explicit|inferred","scope":"适用情境"}],"acknowledge":["已理解事件 ID"],"continue":false}
修改记录必须带读到的 revision；新建用 0。只保存可续接的结论，不保存原始思维链。没有进展可不写。启用此通道后以 mind.records 取代旧 inner.thoughts/resolve，旧念头已迁入并保留来源。
thought 是自己的问题，preference 是对用户的理解，两者不能混淆。没有回复不表示认可、反感或关系变化。
明确反馈按被纠正的内容、时机或表达维度更新，保留来源；不要泛化到其他维度。主动发现可现在表达、下次再谈或静默吸收。用户承诺的交付仍由 Task 可靠完成。
若还有可推进的纯思考可 continue:true；也可等待新证据或设 reconsiderAt。思考不会自动授权外部行动。事件仅在实际理解后 acknowledge；更新记录和确认事件在同一事务提交。`

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
            understanding: String(row.content), open: '', evidence: [`memory:thought:${row.id}`], links: row.related_concern_id ? [`concern:${row.related_concern_id}`] : [],
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
    const records = this.db.prepare('SELECT document FROM mind_records').all().map(r => JSON.parse(String(r.document)) as MindRecord)
      .filter(r => query ? JSON.stringify(r).toLocaleLowerCase().includes(needle) : r.status === 'open' || r.status === 'waiting')
      .sort((a,b) => Number(!!b.reconsiderAt && b.reconsiderAt <= now) - Number(!!a.reconsiderAt && a.reconsiderAt <= now) || b.updatedAt.localeCompare(a.updatedAt))
    const events = this.db.prepare('SELECT document FROM mind_events WHERE handled_at IS NULL ORDER BY rowid LIMIT ?').all(limit).map(r => JSON.parse(String(r.document)) as MindEvent)
    return { records: records.slice(0, limit), events }
  }
  context() { return MIND_PROTOCOL + '\n' + JSON.stringify(this.view()) }
  commit(raw: unknown, source: string, seen: MindView) {
    if (raw === undefined) return
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('mind must be an object')
    const patch = raw as MindPatch
    if ((patch.records !== undefined && !Array.isArray(patch.records)) || (patch.acknowledge !== undefined && !Array.isArray(patch.acknowledge))) throw new TypeError('invalid mind patch')
    const now = this.now().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of patch.records ?? []) {
        if (!record || typeof record.id !== 'string' || !record.id.trim() || !Number.isSafeInteger(record.revision) || record.revision < 0
          || !['thought','preference'].includes(record.kind) || !['open','waiting','resolved','released'].includes(record.status)
          || !['explicit','inferred'].includes(record.basis) || !Array.isArray(record.evidence) || !record.evidence.every(x => typeof x === 'string')
          || !Array.isArray(record.links) || !record.links.every(x => typeof x === 'string')
          || ['topic','understanding','open','scope'].some(k => typeof (record as unknown as Record<string,unknown>)[k] !== 'string')
          || (record.reconsiderAt !== null && !Number.isFinite(Date.parse(record.reconsiderAt)))) throw new TypeError('invalid mind record')
        if (!record.evidence.length) throw new TypeError('mind record requires evidence references')
        const row = this.db.prepare('SELECT document FROM mind_records WHERE id=?').get(record.id)
        const previous = row ? JSON.parse(String(row.document)) as MindRecord : null
        if ((previous?.revision ?? 0) !== record.revision) throw new Error(`mind revision conflict: ${record.id}`)
        this.db.prepare('INSERT OR REPLACE INTO mind_records VALUES(?,?)').run(record.id, JSON.stringify({ ...record, revision: record.revision + 1, updatedAt: now }))
      }
      for (const id of patch.acknowledge ?? []) {
        if (!seen.events.some(e => e.id === id)) throw new Error('cannot acknowledge an unseen event')
        this.db.prepare('UPDATE mind_events SET handled_at=? WHERE id=? AND handled_at IS NULL').run(now, id)
      }
      this.db.prepare('INSERT INTO mind_commits VALUES(?,?,?,?)').run(randomUUID(), source, JSON.stringify(patch), now)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
