import test from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { MindStore } from 'lykoi-runtime/mind'
import { makeConversation, makeStore, T0 } from './fixture.ts'

test('conversation commits contextual feedback to the same Mind later read by Wake; legacy inner no longer writes', async () => {
  const prepared = makeStore(), mind = new MindStore(join(dirname(prepared.path), 'mind.sqlite'), () => T0)
  let calls = 0
  const h = makeConversation({ prepared, mind, llm: async messages => {
    calls++
    const protocol = messages.at(-1)!
    assert.equal(protocol.role, 'system')
    assert.ok(protocol.content!.includes('顶层加入 mind'))
    assert.ok(!protocol.content!.includes('念头本体'))
    assert.ok(!protocol.content!.includes('\"inner\":'))
    const text = messages.map(m => m.content).join('\n')
    if (calls === 2) assert.ok(text.includes('普通产品小更新不主动通知'))
    return { content: JSON.stringify({ decision: { kind: 'reply', content: calls === 1 ? '记住了。' : '先给你结论。' },
      inner: { thoughts: [{ content: '旧通道不应创建重复记录', kind: 'question' }], resolve: [] },
      ...(calls === 1 ? { mind: { records: [{ id: 'contact-scope', revision: 0, kind: 'preference', topic: '主动联系范围', understanding: '普通产品小更新不主动通知',
        open: null, evidence: ['conversation:feedback:1'], links: [], status: 'open', reconsiderAt: null, basis: 'explicit', scope: 'Agent 产品新闻；仍关心持续认知' }], acknowledge: ['conversation:feedback:1'] } } : {}),
    }) }
  } })
  try {
    mind.receive({ id: 'conversation:feedback:1', source: 'user', reference: 'turn:1', content: '这种小更新不用特意说', createdAt: T0.toISOString() })
    assert.equal(await h.conversation.send('这种小更新不用特意说', { turnId: 'feedback:1' }), '记住了。')
    assert.equal(mind.view().records[0]!.basis, 'explicit')
    assert.equal(mind.view().events.length, 0)
    assert.equal(h.store.openThoughts().length, 0)
    assert.equal(await h.conversation.send('继续上次的问题'), '先给你结论。')
    assert.equal(mind.view().records[0]!.revision, 1)
  } finally { h.store.close(); mind.close() }
})

test('mind.read brings historical records into the next Conversation snapshot before editing', async () => {
  const prepared=makeStore(), mind=new MindStore(join(dirname(prepared.path),'mind.sqlite'),()=>T0)
  const content={kind:'thought',topic:'旧问题',understanding:'已有结论',open:null,evidence:['old:source'],links:[],reconsiderAt:null,basis:'inferred',scope:'历史'}
  mind.commit({records:[{...content,id:'archived'},...Array.from({length:25},(_,i)=>({...content,id:`active-${i}`,open:'待证据'}))]},'seed',mind.view())
  let calls=0
  const h=makeConversation({prepared,mind,wiredActions:new Set(['mind.read']),
    capabilities:()=>[{name:'mind.read',description:'读取历史',inputSchema:{type:'object',properties:{query:{type:'string'}}}}],
    dispatchFn:async()=>({success:true,data:mind.view('archived')}),
    llm:async messages=>{
      calls++
      if(calls===1)return {content:JSON.stringify({decision:{kind:'tool_call',tool:{name:'mind.read',arguments:{query:'archived'}}}})}
      assert.ok(messages.some(m=>m.content?.includes('共享心智工作集') && m.content.includes('archived')))
      return {content:JSON.stringify({decision:{kind:'reply',content:'重新打开了。'},mind:{records:[{...content,id:'archived',open:'新证据待核对'}]}})}
    },
  })
  try {assert.equal(await h.conversation.send('重新看看旧问题'),'重新打开了。');assert.equal(mind.view('archived').records[0]!.revision,2)}
  finally {mind.close();prepared.store.close()}
})
