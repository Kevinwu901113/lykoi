import { closeSync, lstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, constants } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export interface SkillSource { kind: 'user' | 'execution'; reference: string }
export interface Skill {
  id: string; title: string; summary: string; body: string
  source: SkillSource; revision: number; updatedAt: string
}
export type SaveSkill = Pick<Skill, 'title' | 'summary' | 'body' | 'source'> & { id?: string; revision?: number }
const ID = /^[a-f0-9]{64}$/
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

/** Synchronous compare-and-replace inside P1's single active instance process. */
export class SkillStore {
  readonly root: string
  readonly now: () => Date
  constructor(root: string, now: () => Date = () => new Date()) {
    this.root = root; this.now = now
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!lstatSync(root).isDirectory()) throw new Error("skill root must be an instance-owned directory")
  }
  creationId(operationId?: string) { return digest(operationId ?? randomUUID()) }
  #path(id: string) {
    if (!ID.test(id)) throw new TypeError('invalid skill ID')
    return join(this.root, `${id}.json`)
  }
  read(id: string): Skill {
    const fd = openSync(this.#path(id), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const skill = JSON.parse(readFileSync(fd, 'utf8')) as Skill
      if (!skill || skill.id !== id || !Number.isSafeInteger(skill.revision) || skill.revision < 1
        || typeof skill.updatedAt !== 'string' || !Number.isFinite(Date.parse(skill.updatedAt))) throw new Error('invalid skill record')
      this.#validate(skill)
      return skill
    } finally { closeSync(fd) }
  }
  #validate(input: SaveSkill) {
    for (const field of ['title', 'summary', 'body'] as const) {
      if (typeof input[field] !== 'string' || !input[field].trim()) throw new TypeError(`${field} must be non-empty`)
      const limit = { title: 160, summary: 600, body: 64000 }[field]
      if (input[field].length > limit) throw new TypeError(`${field} exceeds ${limit} characters`)
    }
    if (!input.source || !['user', 'execution'].includes(input.source.kind)
      || typeof input.source.reference !== 'string' || !input.source.reference.trim()) throw new TypeError('source needs kind and reference')
  }
  list(query = '', offset = 0, limit = 20) {
    const matches: Array<Pick<Skill, 'id' | 'title' | 'summary'>> = []
    const errors: Array<{ id: string; error: string }> = []
    const files = readdirSync(this.root).filter(f => f.endsWith('.json')).sort()
    const needle = query.toLocaleLowerCase()
    // Pagination bounds both results and corrupt-file observations. Offset indexes files,
    // including nonmatches; the caller can continue even when this page has no match.
    let cursor = offset
    for (; cursor < files.length && cursor < offset + limit; cursor++) {
      const id = files[cursor]!.slice(0, -5)
      try {
        const skill = this.read(id)
        if ([skill.title, skill.summary, skill.body].some(text => text.toLocaleLowerCase().includes(needle))) {
          matches.push({ id, title: skill.title, summary: skill.summary })
        }
      } catch (error) { errors.push({ id, error: String(error) }) }
    }
    return { skills: matches, errors, nextOffset: cursor < files.length ? cursor : null }
  }
  recent(limit = 10) {
    return readdirSync(this.root).filter(f => f.endsWith('.json')).map(f => this.read(f.slice(0, -5)))
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit)
      .map(({ id, title, summary, source, revision, updatedAt }) => ({ id, title, summary, source, revision, updatedAt }))
  }
  save(input: SaveSkill, operationId?: string): Skill {
    this.#validate(input)
    const id = input.id ?? this.creationId(operationId)
    const path = this.#path(id)
    if (input.id) {
      const previous = this.read(id)
      if (input.revision !== previous.revision) throw new Error(`revision conflict: current revision is ${previous.revision}`)
      if (input.source.kind !== previous.source.kind || input.source.reference !== previous.source.reference) {
        throw new Error('source is the original provenance; retain it and add later references in body')
      }
    } else {
      if (input.revision !== undefined) throw new TypeError('revision is only used for updates')
      try { lstatSync(path) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return this.#write({ ...input, id, revision: 1, updatedAt: this.now().toISOString() })
      }
      throw new Error('skill already exists; read its revision before updating')
    }
    const skill: Skill = { id, title: input.title, summary: input.summary, body: input.body,
      source: input.source, revision: (input.revision ?? 0) + 1, updatedAt: this.now().toISOString() }
    return this.#write(skill)
  }
  #write(skill: Skill): Skill {
    const path = this.#path(skill.id)
    const temp = join(this.root, `.${randomUUID()}.tmp`)
    try {
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify(skill, null, 2) + '\n'); fsyncSync(fd) }
      finally { closeSync(fd) }
      renameSync(temp, path); this.#sync()
    }
    finally { try { unlinkSync(temp) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
    return skill
  }
  remove(id: string) { unlinkSync(this.#path(id)); this.#sync(); return { removed: id } }
  #sync() {
    const fd = openSync(this.root, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
}
