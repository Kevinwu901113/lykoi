import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DurableTurnStore, DurableIngress, type InboundPart } from '../src/index.ts'
import type { AuditEvent } from 'lykoi-audit'

const now = new Date('2026-09-07T00:00:00.000Z')
function part(n: number): InboundPart {
  return { inboundId: `in-${n}`, channel: 'telegram', platformMessageId: `${n}`,
    userId: 'owner', contextId: 'peer', isOwner: true, receivedAt: now.toISOString(), text: `原文${n}` }
}
const temporary = () => join(mkdtempSync(join(tmpdir(), 'spool-revision-')), 'spool.db')

test('基础设施 schema 1→2：原 turn/part 不变，新增 revision 元数据缺省为零；重开幂等', () => {
  const path = temporary()
  const db = new DatabaseSync(path)
  db.exec(readFileSync(new URL('./fixtures/spool-v1.sql', import.meta.url), 'utf8'))
  db.exec(`INSERT INTO user_turns(id,channel,user_id,context_id,is_owner,first_received_at,last_received_at,created_at,updated_at)
    VALUES('legacy','telegram','owner','peer',1,'2026-09-07T00:00:00Z','2026-09-07T00:00:00Z','2026-09-07T00:00:00Z','2026-09-07T00:00:00Z');
    INSERT INTO inbound_parts(inbound_id,channel,platform_message_id,user_id,context_id,is_owner,text,received_at,turn_id,part_order,created_at)
    VALUES('in-1','telegram','1','owner','peer',1,' 原文\n','2026-09-07T00:00:00Z','legacy',0,'2026-09-07T00:00:00Z')`)
  db.close()
  for (let i = 0; i < 2; i++) {
    const store = new DurableTurnStore(path)
    store.close()
  }
  const raw = new DatabaseSync(path)
  assert.equal(raw.prepare('PRAGMA user_version').get()!.user_version, 2)
  assert.equal(raw.prepare('SELECT text FROM inbound_parts').get()!.text, ' 原文\n')
  assert.equal(raw.prepare('SELECT state FROM user_turns').get()!.state, 'collecting')
  const row = raw.prepare('SELECT revision,revision_pending,aborted_runs_json FROM user_turns').get()!
  assert.deepEqual({ ...row }, { revision: 0, revision_pending: 0, aborted_runs_json: '[]' })
  raw.close()
})

test('durable 附加后 abort 前崩溃：重启同 turn r1，run_aborted 有账且 terminal 恰一次', async () => {
  const path = temporary()
  const store = new DurableTurnStore(path)
  const accepted = store.accept(part(1), 1500, 4000)
  store.commitDue(new Date(now.getTime() + 2000), 1500, 4000)
  const claimed = store.claimNext(now)!
  assert.equal(claimed.runId, `run:${accepted.turnId}:r0`)
  assert.equal(store.accept(part(2), 1500, 4000, accepted.turnId).revised, true)
  store.close()
  const events: AuditEvent[] = []
  let calls = 0
  for (let i = 0; i < 2; i++) {
    const ingress = new DurableIngress({ dbPath: path, audit: { async record(event) { events.push(event) } }, now: () => now })
    ingress.registerExecutor(async (turn, context) => {
      calls++
      assert.equal(turn.turnId, accepted.turnId)
      assert.equal(context.runId, `run:${accepted.turnId}:r1`)
      assert.deepEqual(turn.parts.map(p => p.text), ['原文1', '原文2'])
      return { terminal: { status: 'replied', reason: null, followup_registered: false, ask_sent: false,
        notice_sent: false, reply_chars: 1, elapsed_ms: 0 } }
    })
    await ingress.start(); await ingress.drain(); await ingress.close()
  }
  assert.equal(calls, 1)
  assert.equal(events.filter(e => e.type === 'converse/run_aborted').length, 1)
  assert.equal(events.filter(e => e.type === 'converse/turn_terminal').length, 1)
})
