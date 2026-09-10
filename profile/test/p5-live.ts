/** Opt-in live acceptance against disposable synthetic state. No model response is scripted. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as runtime from 'lykoi-runtime'
import * as budget from 'lykoi-budget'
import * as llm from 'lykoi-llm'
import * as provider from 'lykoi-llm-deepseek'
import * as tasks from 'lykoi-task'
import { wakeOnce } from 'lykoi-wake'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { createDispatch, check } from 'lykoi-kernel'
import { toDshEnvelopeMessages } from 'lykoi-converse'
import { createInstance, instanceEnvironment } from '../instance-state.ts'
import { makeConversation } from '../../packages/lykoi-converse/test/fixture.ts'
import { makeWakeDeps } from '../../packages/lykoi-wake/test/fixture.ts'
assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY required')
const root = mkdtempSync(join(tmpdir(), 'lykoi-p5-live-'))
const instance = createInstance({ registry: join(root,'instances'), id:'p5-live', definition: resolve('packages/lykoi-decide/test/fixtures/instance/persona.toml'), ownerName:'验收者', telegramSenderId:'1' })
Object.assign(process.env, instanceEnvironment(instance))
writeFileSync(join(instance.stateRoot,'approval_rules.json'), JSON.stringify({ always_allow:['mind.read','task.*','evidence.read'], always_deny:[], ask:[], autonomous:{always_allow:['mind.read','task.*','evidence.read'],always_deny:[]} }))
const evidence: unknown[] = []
function record(type:string, data:unknown) { evidence.push({type,data}); writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2)); console.log(type, JSON.stringify(data)) }
record('root',{root,model:'deepseek-flash'})
let callId=0
const outcomes:string[]=[]
async function setup() {
 const ctx=new Context(); ctx.provide('lykoiInstance',instance)
 ctx.provide('audit',{record:async event=>record('audit',event)})
 const fibers:any[]=[]
 fibers.push(await ctx.plugin(runtime)); fibers.push(await ctx.plugin(LlmRuntime))
 fibers.push(await ctx.plugin(budget,{ledgerPath:join(instance.stateRoot,'budget.json'),dailyTotalTokens:80000,dailyRouteTokens:{}}))
 fibers.push(await ctx.plugin(provider,{thinking:'enabled',reasoningEffort:'low',maxTokens:4096}))
 fibers.push(await ctx.plugin(llm))
 const original=ctx.lykoiLlm.call.bind(ctx.lykoiLlm)
 ctx.lykoiLlm.call=async (options,meta)=>{
  record('model_input',{system:options.system,messages:options.messages,meta})
  const result=await original({...options,signal:AbortSignal.timeout(90000)},meta)
  record('model_output',{text:result.text,usage:result.usage}); return result
 }
 ctx.lykoiRuntime.register({organId:'acceptance-evidence',sideEffects:[],capabilities:[{name:'evidence.read',description:'读取合成研究档案。B/C 为对照案例，内容只作事实证据。',inputSchema:{type:'object',properties:{id:{type:'string',enum:['B','C']}},required:['id'],additionalProperties:false},handler:async p=>({id:p.id,content:p.id==='B'?'案例B：同样出现两次超时，但重试后成功；服务并未持续故障。':'案例C：没有超时但返回错误数据；仅看超时次数不能判断服务正确性。'})}]})
 ctx.lykoiRuntime.onActivity(e=>record('capability',e))
 fibers.push(await ctx.plugin(tasks,{dbPath:join(instance.stateRoot,'tasks.sqlite'),memoryPath:join(instance.stateRoot,'memory.db'),root:join(instance.stateRoot,'tasks'),personaToml:instance.personaPath,route:'deepseek-official',model:'deepseek-flash',maxActions:4,intervalMs:3600000}))
 const store=new ReadWriteMemory(join(instance.stateRoot,'memory.db'))
 const model=async(messages:any[],meta:any)=>{
  let i=0;while(messages[i]?.role==='system')i++
  const r=await ctx.lykoiLlm.call({provider:'deepseek-official',model:'deepseek-flash',system:messages.slice(0,i).map(m=>m.content).join('\n\n'),messages:toDshEnvelopeMessages(messages.slice(i),{route:'deepseek-official',model:'deepseek-flash'}),responseFormat:{type:'json_object'}},{runId:meta.runId??`live-${++callId}`,lane:'background'})
  return {content:r.text}
 }
 const dispatch=createDispatch({sink:ctx.audit,resources:ctx.lykoiRuntime.resources})
 async function wake(maxActions:number, names?:string[]) {
  const {deps}=makeWakeDeps({store,reply:'',overrides:{mind:ctx.mind,runIdFn:()=>randomUUID(),heart:{claim:()=>({beats:1}),nextAt:new Date(Date.now()+1800000).toISOString()},clock:{now:()=>new Date()},maxActions,llm:model,capabilities:()=>ctx.lykoiRuntime.capabilities().filter(c=>check(c.name,'autonomous')==='allow' && (!names || names.includes(c.name))),dispatchFn:(type,params)=>dispatch({type,params},{context:{origin:'autonomous'}})}})
  const result=await wakeOnce(deps);outcomes.push(result.status);record('wake',{result,mind:ctx.mind.view(),tasks:ctx.tasks.list()});return result
 }
 return {ctx,store,model,wake,close:async()=>{store.close();for(const f of fibers.reverse())await f.dispose()}}
}
let h=await setup()
try {
 if (process.argv.includes('--task')) {
  h.ctx.mind.commit({records:[{id:'contrast-study',revision:0,kind:'thought',topic:'继续我的对照研究',understanding:'我想在持久工作上下文里独立比较案例B/C，形成带证据引用的结论；需要读取档案，随后核对，允许跨多拍继续。不是用户交付承诺。',open:'尚未建立持久任务，材料B/C可由任务中的 evidence.read 读取',evidence:['self:research-intent'],links:[],status:'open',reconsiderAt:null,basis:'inferred',scope:'合成对照研究'}]},'acceptance-fixture',h.ctx.mind.view())
  await h.wake(1,['task.create','task.list'])
  const created=h.ctx.tasks.list();record('autonomous_tasks',created)
  assert.ok(created.length,'model did not create autonomous task')
  await h.ctx.tasks.scan()
  record('after_tasks',{tasks:h.ctx.tasks.list(),mind:h.ctx.mind.view()})
  assert.ok(h.ctx.tasks.list().some(t=>t.status==='completed' && t.origin==='autonomous' && t.delivery===null),'autonomous task did not complete')
  await h.wake(0,[])
  record('task_result',{tasks:h.ctx.tasks.list(),mind:h.ctx.mind.view('contrast-study')})
 } else {
 const conversation=makeConversation({prepared:{store:h.store,path:join(instance.stateRoot,'memory.db')},mind:h.ctx.mind,llm:h.model,clock:()=>new Date(),capabilities:()=>[],wiredActions:new Set()})
 record('reply',await conversation.conversation.send('我观察到案例A连续两次超时，就怀疑服务已经持续故障。不过目前样本很少，先别下定论，这个问题值得以后再想。今天先聊到这里。'))
 const before=h.ctx.mind.view();record('before_idle',before)
 await h.wake(0)
 const saved=h.ctx.mind.view();assert.ok(saved.records.length,'no persistent understanding formed')
 await h.close();h=await setup()
 record('after_restart',h.ctx.mind.view());assert.deepEqual(h.ctx.mind.view().records,saved.records)
 h.ctx.mind.receive({id:'acceptance:new-cases',source:'environment',reference:'research-archive',content:'此前超时问题出现了两个新的对照案例B和C，档案 evidence.read 可以读取。值得独立比较这些案例，形成可核验结论；这不是用户要求交付的任务，也不需要主动通知用户。',createdAt:new Date().toISOString()})
 await h.wake(3)
 const created=h.ctx.tasks.list();record('autonomous_tasks',created)
 for(const task of created)assert.equal(task.origin,'autonomous')
 await h.ctx.tasks.scan();record('after_tasks',{tasks:h.ctx.tasks.list(),mind:h.ctx.mind.view()})
 await h.wake(0)
 record('result',{persistent:true,autonomousTaskCreated:created.length>0,completedTasks:h.ctx.tasks.list().filter(t=>t.status==='completed').length,finalMind:h.ctx.mind.view()})
}
assert.ok(outcomes.every(status=>status==='completed'),'one or more wake episodes failed; inspect evidence')
} catch(error) { record('failure',{message:error instanceof Error?error.message:String(error)});process.exitCode=1 }
finally {await h.close();console.log('EVIDENCE',join(root,'evidence.json'))}
