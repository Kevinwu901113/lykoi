/**
 * lykoi-heart 测试夹具。
 *
 * salience 读侧测试自建 tmp 影子库：DDL 逐字取 WO-M0-STATE-CONTRACT §3.1
 * （= mind/salience_shadow.py:141-187 的 _SCHEMA），含 append-only /
 * decision-immutable / outcome-write-once 三触发器与 WAL。零她的数据。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const T0 = new Date('2026-08-24T10:00:00Z')

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-heart-'))
}

/** STATE-CONTRACT §3.1 DDL 逐字（salience_shadow.py:141-187 _SCHEMA）。 */
export const SALIENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS posterior (
    key TEXT PRIMARY KEY,
    alpha REAL NOT NULL,
    beta REAL NOT NULL,
    last_update_ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shadow_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    experience_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    score REAL NOT NULL,
    boost REAL NOT NULL,
    explore_flag INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL,
    skip_reason TEXT,
    load_value REAL NOT NULL,
    load_tier INTEGER NOT NULL,
    presented_today INTEGER NOT NULL,
    presented_hour INTEGER NOT NULL,
    outcome TEXT,
    outcome_ts TEXT,
    outcome_integration_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_experience ON shadow_log(experience_id);
CREATE INDEX IF NOT EXISTS idx_shadow_pending ON shadow_log(outcome) WHERE outcome IS NULL;
CREATE TRIGGER IF NOT EXISTS shadow_log_no_delete
BEFORE DELETE ON shadow_log
BEGIN SELECT RAISE(ABORT, 'shadow_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS shadow_log_decision_immutable
BEFORE UPDATE ON shadow_log
WHEN NEW.ts IS NOT OLD.ts OR NEW.experience_id IS NOT OLD.experience_id
  OR NEW.source IS NOT OLD.source OR NEW.key IS NOT OLD.key
  OR NEW.score IS NOT OLD.score OR NEW.boost IS NOT OLD.boost
  OR NEW.explore_flag IS NOT OLD.explore_flag OR NEW.selected IS NOT OLD.selected
  OR NEW.skip_reason IS NOT OLD.skip_reason OR NEW.load_value IS NOT OLD.load_value
  OR NEW.load_tier IS NOT OLD.load_tier
  OR NEW.presented_today IS NOT OLD.presented_today
  OR NEW.presented_hour IS NOT OLD.presented_hour
BEGIN SELECT RAISE(ABORT, 'shadow_log decision columns are immutable'); END;
CREATE TRIGGER IF NOT EXISTS shadow_log_outcome_write_once
BEFORE UPDATE ON shadow_log
WHEN OLD.outcome IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'shadow_log outcome is write-once'); END;
`

let nextExperienceId = 1

/** 建一个空白 tmp 影子库（WAL，与 sidecar 拥有者同款——salience_shadow.py:204）。 */
export function makeSalienceDb(dir: string = tmp()): string {
  const path = join(dir, 'salience_shadow.db')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(SALIENCE_SCHEMA)
  } finally {
    db.close()
  }
  return path
}

/** 摄入若干行（selected 可控；experience_id 全局递增以满足 UNIQUE）。 */
export function insertShadowRows(path: string, n: number, selected: 0 | 1, ts = '2026-08-24T09:00:00+00:00'): void {
  const db = new DatabaseSync(path)
  try {
    const stmt = db.prepare(
      `INSERT INTO shadow_log
         (ts, experience_id, source, key, score, boost, explore_flag, selected,
          load_value, load_tier, presented_today, presented_hour)
       VALUES (?, ?, 'conversation', 'k', 0.5, 0.0, 0, ?, 0.2, 0, 0, 0)`,
    )
    for (let i = 0; i < n; i++) {
      stmt.run(ts, nextExperienceId++, selected)
    }
  } finally {
    db.close()
  }
}
