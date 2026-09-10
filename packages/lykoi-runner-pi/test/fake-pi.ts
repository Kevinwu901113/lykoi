/** RPC process fixture; deliberately not a real model acceptance. */
import { createInterface } from 'node:readline'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
let streaming = false, timer: NodeJS.Timeout | undefined
const send = (data: unknown) => process.stdout.write(JSON.stringify(data) + '\n')
const output = 'generated runner-result.txt'
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  const data = request.type === 'get_state' ? { isStreaming: streaming, isCompacting: false, pendingMessageCount: 0, sessionId: 'fixture-session', sessionFile: join(process.cwd(), 'session.jsonl') }
    : request.type === 'get_session_stats' ? { tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 } }
    : request.type === 'get_messages' ? { messages: [{ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: output }] }] } : undefined
  if (request.type === 'prompt') {
    streaming = true; appendFileSync('starts.txt', 'start\n')
    timer = setTimeout(() => { writeFileSync('runner-result.txt', request.message); streaming = false; send({ type: 'agent_settled' }) }, request.message === 'slow' ? 10000 : 300)
  }
  if (request.type === 'abort') { clearTimeout(timer); streaming = false }
  send({ type: 'response', id: request.id, success: true, data })
}
