import test from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { MindStore } from 'lykoi-runtime/mind'
import { wakeOnce } from '../src/index.ts'
import { makeStore, makeWakeDeps, rawOpen, T0 } from './fixture.ts'

test('pure episodes continue with zero actions, survive restart and consume later evidence', async () => {
  const { store, path } = makeStore(), mindPath = join(dirname(path), 'mind.sqlite')
  let mind = new MindStore(mindPath, () => T0), calls = 0
  const run = async () => {
    const { deps } = makeWakeDeps({ store, reply: '{}', overrides: {
      mind, runIdFn: () => `mind-run-${calls}`, maxActions: 0, dispatchFn: async () => { throw new Error('pure thought must not dispatch') },
      llm: async messages => {
        calls++
        const context = messages.map(m => m.content).join('\n')
        const previous = mind.view().records[0]
        if (previous) assert.ok(context.includes(previous.understanding))
        const event = mind.view().events[0]
        const understanding = event ? '第二案例推翻统一流程假设，应保留领域差异' : calls === 1 ? '发现共同模式，尚需比较' : '共同模式可能只适用于部分领域'
        return { content: JSON.stringify({ decision: { kind: 'contemplate', reason: '继续未解决的问题' }, mind: {
          records: [{ id: 'methods', revision: previous?.revision ?? 0, kind: 'thought', topic: '是否可泛化', understanding,
            open: '待比较', evidence: event ? ['case:A', event.id] : ['case:A'], links: [], status: 'open', reconsiderAt: null, basis: 'inferred', scope: '方法研究' }],
          acknowledge: event ? [event.id] : [], continue: calls === 1,
        } }) }
      },
    } })
    return wakeOnce(deps)
  }
  try {
    assert.equal((await run()).status, 'completed'); assert.equal(calls, 2)
    mind.close(); mind = new MindStore(mindPath, () => T0)
    mind.receive({ id: 'case:B', source: 'task', reference: 'task:B', content: '不同领域流程相反', createdAt: T0.toISOString() })
    assert.equal((await run()).status, 'completed'); assert.equal(calls, 3)
    assert.equal(mind.view().events.length, 0)
    assert.ok(mind.view().records[0]!.understanding.includes('推翻'))
    assert.equal(store.autonomyActionsLastHour({ now: T0 }), 0)
  } finally { mind.close(); store.close() }
})


test('Mind wake leaves legacy Thought rows untouched and rest relieves load without an action', async () => {
  const { store, path } = makeStore(), mind = new MindStore(join(dirname(path), 'mind.sqlite'), () => T0)
  const raw = rawOpen(path)
  store.createThought('退休前未完成的问题', 'question', 'wake', { now: T0, chargeHint: 0.16 })
  const before = raw.prepare('SELECT * FROM thoughts').all()
  const load = store.getRegulation({ now: T0 }).load
  const { deps } = makeWakeDeps({ store, reply: JSON.stringify({ decision: { kind: 'rest', reason: '休息' } }), overrides: {
    mind, maxActions: 0, dispatchFn: async () => { throw new Error('rest must not dispatch') },
  } })
  try {
    assert.equal((await wakeOnce(deps)).status, 'completed')
    assert.deepEqual(raw.prepare('SELECT * FROM thoughts').all(), before)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM experiences WHERE source = 'thought_lapse'").get()!.n, 0)
    assert.ok(Math.abs(store.getRegulation({ now: T0 }).load - (load - 0.1)) < 1e-9)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM regulation_events WHERE cause = 'rested'").get()!.n, 1)
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM regulation_events WHERE cause = 'action_taken'").get()!.n, 0)
    assert.equal(store.autonomyActionsLastHour({ now: T0 }), 0)
  } finally { raw.close(); mind.close(); store.close() }
})

test('Wake refreshes searched history and hides tool catalog when the action budget is spent', async () => {
  const {store,path}=makeStore(), mind=new MindStore(join(dirname(path),'mind.sqlite'),()=>T0)
  const content={kind:'thought',topic:'旧问题',understanding:'历史结论',open:null,evidence:['source'],links:[],reconsiderAt:null,basis:'inferred',scope:'历史'}
  mind.commit({records:[{...content,id:'archived'},...Array.from({length:25},(_,i)=>({...content,id:`active-${i}`,open:'待证据'}))]},'seed',mind.view())
  let calls=0
  const {deps}=makeWakeDeps({store,reply:'',overrides:{mind,maxActions:1,
    capabilities:()=>[{name:'mind.read',description:'读取历史',inputSchema:{type:'object',properties:{query:{type:'string'}}}}],
    dispatchFn:async()=>({success:true,data:mind.view('archived')}),
    llm:async messages=>{
      calls++
      if(calls===1)return {content:JSON.stringify({decision:{kind:'tool_call',tool:{name:'mind.read',arguments:{query:'archived'}}}})}
      assert.ok(messages.some(m=>m.content.includes('共享心智工作集') && m.content.includes('archived')))
      assert.ok(!messages.some(m=>m.content.includes('当前获准使用的能力')))
      const snapshot = JSON.parse(messages.find(m=>m.role==='user' && m.content.includes('候选动作'))!.content)
      assert.equal(snapshot.本拍剩余执行步数,0)
      assert.ok(snapshot.候选动作.every((c:{kind:string})=>['rest','contemplate'].includes(c.kind)))
      return {content:JSON.stringify({decision:{kind:'contemplate'},mind:{records:[{...content,id:'archived',open:'等待新的对照'}]}})}
    },
  }})
  try {assert.equal((await wakeOnce(deps)).status,'completed');assert.equal(mind.view('archived').records[0]!.revision,2)}
  finally {mind.close();store.close()}
})

test('Wake receives a Mind rejection before executing and can correct it within the same bound', async () => {
  const {store,path} = makeStore(), mind = new MindStore(join(dirname(path),'mind.sqlite'),()=>T0)
  let calls = 0, dispatches = 0
  const {deps} = makeWakeDeps({store,reply:'',overrides:{mind,maxActions:1,
    dispatchFn:async()=>{dispatches++;return {success:true}},
    llm:async messages=>{
      if (++calls === 1) return {content:JSON.stringify({decision:{kind:'rest'},mind:{acknowledge:['unseen']}})}
      assert.ok(messages.some(m=>m.content.includes('unseen_event')))
      return {content:JSON.stringify({decision:{kind:'rest'}})}
    },
  }})
  try {assert.equal((await wakeOnce(deps)).status,'completed');assert.equal(calls,2);assert.equal(dispatches,0)}
  finally {mind.close();store.close()}
})
