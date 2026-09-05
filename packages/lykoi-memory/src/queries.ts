import type { DatabaseSync } from 'node:sqlite'
import type { RegulationFieldRow, ThoughtRow, AutonomyStateRow } from './index.ts'

// 同一 state 的只读查询；连接权限与生命周期仍由 RO/RW 入口持有。
export function regulationField(db: DatabaseSync): RegulationFieldRow[] {
  const rows = db.prepare(
    'SELECT name, value, baseline, updated_at FROM regulation_field ORDER BY name',
  ).all() as { name: string; value: number; baseline: number; updated_at: string }[]
  return rows.map((r) => ({
    name: r.name as RegulationFieldRow['name'],
    value: r.value,
    baseline: r.baseline,
    updatedAt: r.updated_at,
  }))
}

export function openThoughts(db: DatabaseSync): ThoughtRow[] {
  const rows = db.prepare(
    `SELECT id, ts, content, kind, source, related_concern_id, source_ref, charge, status
       FROM thoughts WHERE status = 'open' ORDER BY id`,
  ).all() as Record<string, unknown>[]
  return rows.map((r) => ({
    id: r.id as number,
    ts: r.ts as string,
    content: r.content as string,
    kind: r.kind as string,
    source: r.source as string,
    relatedConcernId: (r.related_concern_id ?? null) as number | null,
    sourceRef: (r.source_ref ?? null) as string | null,
    charge: r.charge as number,
    status: r.status as string,
  }))
}

export function autonomyState(db: DatabaseSync): AutonomyStateRow | undefined {
  const row = db.prepare(
    'SELECT next_wake_at, last_wake_at, updated_at FROM autonomy_state WHERE id = 1',
  ).get() as
    | { next_wake_at: string; last_wake_at: string | null; updated_at: string }
    | undefined
  if (!row) return undefined
  return {
    nextWakeAt: row.next_wake_at,
    lastWakeAt: row.last_wake_at ?? null,
    updatedAt: row.updated_at,
  }
}

export function readMindSchemaVersion(db: DatabaseSync): unknown {
  let version: unknown
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM mind_schema').get() as
      | { version: unknown }
      | undefined
    version = row?.version
  } catch (err) {
    throw new Error(
      'lykoi-memory: cannot read mind_schema from this database — not a Lykoi state copy? '
      + `(${(err as Error).message})`,
    )
  }
  return version
}
