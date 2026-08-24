/**
 * lykoi-kernel 测试夹具。数据纪律：state 文件全走 tmpdir（env 惰性读路径 =
 * 每测试隔离）；合成 db 走 lykoi-memory/testing 的 createStateFixture（DDL
 * 单一出处）；golden devstate 本包不触。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetAuditHealthForTest, _setPolicyCoreForTest, setIdentityBindingLookup,
  setKernelLogEvent,
} from '../src/index.ts'

export const T0 = new Date('2026-08-25T10:00:00Z')

/** 指到 tmpdir 的四个治理 state 文件 + 全部注入位复位。返回 tmpdir。 */
export function isolateKernelState(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-kernel-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  delete process.env.LYKOI_PENDING_TTL_S
  _setPolicyCoreForTest(undefined) // 恢复内建 core
  _resetAuditHealthForTest()
  setIdentityBindingLookup(null)
  setKernelLogEvent(null)
  return dir
}

/** 遥测捕获：events 数组 + 装好的复位。 */
export function captureTelemetry(): { name: string; fields: Record<string, unknown> }[] {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  setKernelLogEvent((name, fields) => events.push({ name, fields }))
  return events
}

/** fake immutable sink：记录全部 record；可注入失败模式。 */
export interface FakeSink {
  records: Record<string, unknown>[]
  /** 置为 Error 时每次 record 抛它；置回 null 恢复。 */
  failWith: Error | null
  record(event: { type: string; [key: string]: unknown }): Promise<void>
}

export function fakeSink(): FakeSink {
  const sink: FakeSink = {
    records: [],
    failWith: null,
    async record(event) {
      if (sink.failWith !== null) throw sink.failWith
      sink.records.push({ ...event })
    },
  }
  return sink
}

/** 带 errno code 的"预期内 sink 故障"（Python OSError 对应）。 */
export function ioError(message = 'disk full'): Error {
  return Object.assign(new Error(message), { code: 'EIO' })
}
