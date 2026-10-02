import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import type {
  DefinitionVersion,
  Instance,
  Json,
  Operation,
  Run,
  Trace,
  Config
} from './contracts.ts'
import { assertJson, validId, validateDefinition } from './definition.ts'
import type { ComponentRegistry } from './registry.ts'

export class ComposerStore {
  #db: DatabaseSync
  readonly now: () => string
  constructor(path: string, now = () => new Date().toISOString()) {
    this.now = now
    this.#db = new DatabaseSync(path)
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS composer_meta (version INTEGER NOT NULL);
      INSERT INTO composer_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM composer_meta);
      CREATE TABLE IF NOT EXISTS definitions (agent_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(agent_id,revision));
      CREATE TABLE IF NOT EXISTS instances (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS traces (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, body TEXT NOT NULL);`)
    if ((this.#db.prepare('SELECT version FROM composer_meta').get() as any).version !== 1)
      throw new Error('unsupported composer database version')
  }
  #transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
  #decode<T>(row: any): T {
    if (!row) throw new Error('record not found')
    return JSON.parse(row.body) as T
  }
  saveDefinition(value: unknown, expectedRevision: number, registry: ComponentRegistry): DefinitionVersion {
    const definition = validateDefinition(value, registry)
    return this.#transaction(() => {
      const latest = this.#db
        .prepare('SELECT revision FROM definitions WHERE agent_id=? ORDER BY revision DESC LIMIT 1')
        .get(definition.id) as any
      if ((latest?.revision ?? 0) !== expectedRevision)
        throw new Error('definition revision conflict; reload before saving')
      const version: DefinitionVersion = {
        agentId: definition.id,
        revision: expectedRevision + 1,
        hash: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
        definition,
        createdAt: this.now()
      }
      this.#db
        .prepare('INSERT INTO definitions VALUES (?,?,?)')
        .run(definition.id, version.revision, JSON.stringify(version))
      return structuredClone(version)
    })
  }
  definitions(): DefinitionVersion[] {
    return this.#db
      .prepare(
        'SELECT body FROM definitions d WHERE revision=(SELECT MAX(revision) FROM definitions WHERE agent_id=d.agent_id) ORDER BY agent_id'
      )
      .all()
      .map((row) => this.#decode<DefinitionVersion>(row))
  }
  definition(id: string, revision?: number): DefinitionVersion {
    return this.#decode(
      revision === undefined
        ? this.#db
            .prepare('SELECT body FROM definitions WHERE agent_id=? ORDER BY revision DESC LIMIT 1')
            .get(id)
        : this.#db.prepare('SELECT body FROM definitions WHERE agent_id=? AND revision=?').get(id, revision)
    )
  }
  createInstance(agentId: string, id: string = randomUUID()): Instance {
    if (!validId(id)) throw new Error('invalid instance ID')
    this.definition(agentId)
    const instance = { id, agentId, createdAt: this.now() }
    this.#db.prepare('INSERT INTO instances VALUES (?,?)').run(id, JSON.stringify(instance))
    return instance
  }
  instance(id: string): Instance {
    return this.#decode(this.#db.prepare('SELECT body FROM instances WHERE id=?').get(id))
  }
  instances(): Instance[] {
    return this.#db
      .prepare('SELECT body FROM instances ORDER BY id')
      .all()
      .map((row) => this.#decode<Instance>(row))
  }
  createRun(instanceId: string, input: Json, revision?: number): Run {
    assertJson(input)
    const instance = this.instance(instanceId),
      version = this.definition(instance.agentId, revision),
      time = this.now()
    const run: Run = {
      id: randomUUID(),
      instanceId,
      version,
      input,
      status: 'queued',
      outputs: {},
      createdAt: time,
      updatedAt: time
    }
    this.#transaction(() => {
      this.#db.prepare('INSERT INTO runs VALUES (?,?)').run(run.id, JSON.stringify(run))
      this.trace(run.id, 'run.created', { revision: version.revision, instanceId })
    })
    return structuredClone(run)
  }
  run(id: string): Run {
    return this.#decode(this.#db.prepare('SELECT body FROM runs WHERE id=?').get(id))
  }
  runs(): Run[] {
    return this.#db
      .prepare('SELECT body FROM runs ORDER BY rowid DESC')
      .all()
      .map((row) => this.#decode<Run>(row))
  }
  editRun(id: string, edit: (run: Run) => void): Run {
    return this.#transaction(() => {
      const run = this.run(id)
      edit(run)
      run.updatedAt = this.now()
      this.#db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(run), id)
      return structuredClone(run)
    })
  }
  operation(id: string): Operation | undefined {
    const row = this.#db.prepare('SELECT body FROM operations WHERE id=?').get(id)
    return row ? this.#decode(row) : undefined
  }
  operations(runId: string): Operation[] {
    return this.#db
      .prepare('SELECT body FROM operations WHERE run_id=? ORDER BY rowid')
      .all(runId)
      .map((row) => this.#decode<Operation>(row))
  }
  startOperation(op: Operation) {
    this.#transaction(() => {
      this.#db.prepare('INSERT INTO operations VALUES (?,?,?)').run(op.id, op.runId, JSON.stringify(op))
      this.trace(op.runId, 'operation.started', {
        operationId: op.id,
        nodeId: op.nodeId,
        component: op.component,
        version: op.version
      })
    })
  }
  settleOperation(op: Operation) {
    this.#transaction(() => {
      const previous = this.operation(op.id)
      if (!previous || previous.runId !== op.runId) throw new Error('operation ownership mismatch')
      this.#db.prepare('UPDATE operations SET body=? WHERE id=?').run(JSON.stringify(op), op.id)
      this.trace(op.runId, `operation.${op.status}`, { operationId: op.id, nodeId: op.nodeId })
    })
  }
  resolveOperation(runId: string, operationId: string, value: Json): Run {
    return this.#transaction(() => {
      const run = this.run(runId),
        op = this.operation(operationId)
      if (!op || op.runId !== runId) throw new Error('invalid callback ownership')
      if (op.status === 'completed') {
        if (JSON.stringify(op.result) !== JSON.stringify(value))
          throw new Error('callback conflicts with committed result')
        return run
      }
      if (
        ['succeeded', 'failed', 'cancelled'].includes(run.status) ||
        run.wait?.operationId !== operationId ||
        !['waiting', 'unknown'].includes(op.status)
      )
        throw new Error('operation is not awaiting input')
      op.status = 'completed'
      op.result = value
      delete run.wait
      delete run.error
      if (run.status !== 'paused') run.status = 'queued'
      run.updatedAt = this.now()
      // Receipt and continuation admission share one durable transaction.
      this.#db.prepare('UPDATE operations SET body=? WHERE id=?').run(JSON.stringify(op), operationId)
      this.#db.prepare('UPDATE runs SET body=? WHERE id=?').run(JSON.stringify(run), runId)
      this.trace(runId, 'operation.completed', { operationId, nodeId: op.nodeId })
      this.trace(runId, 'operation.resolved', { operationId, nodeId: op.nodeId })
      return structuredClone(run)
    })
  }
  trace(runId: string, type: string, data: Config) {
    this.#db
      .prepare('INSERT INTO traces(run_id,body) VALUES (?,?)')
      .run(runId, JSON.stringify({ runId, type, data, at: this.now() }))
  }
  traces(runId: string): Trace[] {
    return this.#db
      .prepare('SELECT sequence,body FROM traces WHERE run_id=? ORDER BY sequence')
      .all(runId)
      .map((row: any) => ({ sequence: Number(row.sequence), ...JSON.parse(row.body) }))
  }
  required(id: string, version: string): boolean {
    return this.runs().some(
      (r) =>
        !['succeeded', 'failed', 'cancelled'].includes(r.status) &&
        r.version.definition.nodes.some((n) => n.component === id && n.version === version)
    )
  }
  close() {
    this.#db.close()
  }
}
