import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, link, truncate, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { CapabilityRuntime } from 'lykoi-runtime'
import { createDispatch, createApprovalConversation, setApprovalInterpretLlm, standingGrants, check, inPresenceReply } from 'lykoi-kernel'
import { workspaceDocument, DOCUMENT_MAX_BYTES } from '../src/document.ts'
import { sendFile, setTransport } from '../src/messenger.ts'
import { outboundCapabilities } from '../src/resources.ts'
import { createFetchHttpPost } from '../src/http.ts'
import { BotApiTransport } from '../src/transport.ts'
import { ProductionTelegramTransport } from '../src/production.ts'
import { TelegramAdapter, messengerTransportBridge } from '../src/index.ts'
import { isolateOutboundState } from '../src/testing.ts'

async function fixture(t: { after(fn: () => unknown): void }) {
  const root = await mkdtemp(join(tmpdir(), 'document-'))
  await mkdir(join(root, 'workspace'))
  isolateOutboundState(root)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(root, 'grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(root, 'pending.json')
  t.after(async () => { setTransport(null); setApprovalInterpretLlm(null); await rm(root, { recursive: true, force: true }) })
  return root
}

test('file export confines paths, rejects aliases/nonfiles/oversize, preserves binary bytes', async t => {
  const root = await fixture(t), ws = join(root, 'workspace')
  const bytes = Buffer.from([0, 255, 13, 10, 128])
  await writeFile(join(ws, 'sample.bin'), bytes)
  assert.deepEqual(Buffer.from((await workspaceDocument(ws, 'sample.bin')).bytes), bytes)
  await writeFile(join(root, 'outside'), 'secret')
  await symlink(join(root, 'outside'), join(ws, 'escape'))
  await symlink(root, join(ws, 'ancestor'))
  await link(join(root, 'outside'), join(ws, 'alias'))
  await writeFile(join(ws, 'big'), ''); await truncate(join(ws, 'big'), DOCUMENT_MAX_BYTES + 1)
  for (const name of ['../outside', '/etc/passwd', 'escape', 'ancestor/outside', 'alias', '.', 'big']) {
    await assert.rejects(workspaceDocument(ws, name), Error, name)
  }
  await assert.rejects(sendFile({ path: 'sample.bin', context_id: '1001' }), /execution context/)
})

test('real approval and production bridge send exact multipart bytes; text grants and E2 cannot export', async t => {
  const root = await fixture(t), ws = join(root, 'workspace'), bytes = Buffer.from('# 交接\r\n\r\n- 完成\r\n')
  await writeFile(join(ws, '交接.md'), bytes)
  await writeFile(join(root, 'rules.json'), JSON.stringify({ always_allow: ['messenger.*'], always_deny: [], ask: [] }))
  assert.equal(check('messenger.send_file','interactive',{ context_id:'1001' },inPresenceReply('1001')), 'ask')
  assert.equal(check('messenger.send_file','autonomous',{ context_id:'1001' }), 'deny')
  const uploads: Buffer[] = [], types: string[] = []
  const server = createServer(async (req,res) => {
    const chunks: Buffer[]=[]; for await (const b of req) chunks.push(Buffer.from(b))
    if (req.url?.endsWith('/sendDocument')) { uploads.push(Buffer.concat(chunks)); types.push(String(req.headers['content-type'])) }
    res.setHeader('content-type','application/json'); res.end(JSON.stringify({ ok:true,result:{ message_id:99 } }))
  })
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = (server.address() as {port:number}).port
  const api = new BotApiTransport({ token:'fixture',apiBase:`http://127.0.0.1:${port}`,post:createFetchHttpPost() })
  const production = new ProductionTelegramTransport(undefined,{ api })
  const adapter = new TelegramAdapter(new Context(), { transport:production,audit:{ record:async()=>{} },
    ingress:{} as never,memory:{} as never,cursorPath:join(root,'cursor.json'),archivePath:join(root,'archive.json'),pollTimeoutS:1 })
  setTransport(messengerTransportBridge(adapter))
  const instance = { version:1 as const,id:'A',origin:'created' as const,createdAt:new Date().toISOString(),definitionHash:'test',personaPath:'fixture',stateRoot:root }
  const runtime = new CapabilityRuntime(()=>{},instance)
  runtime.register({ organId:'telegram',capabilities:outboundCapabilities(instance),sideEffects:[] })
  t.after(()=>runtime.dispose())
  const dispatch = createDispatch({ sink:{record:async()=>{}},resources:runtime.resources })
  const action = { type:'messenger.send_file',params:{path:'交接.md',context_id:'1001',reply_to:'42'} }
  assert.equal((await dispatch(action,{context:{origin:'interactive'}})).error,'needs_approval')
  assert.equal(uploads.length,0)
  const approval = createApprovalConversation({dispatch})
  const pending = await approval.requestApproval(action.type,action.params,{contextId:'1001'})
  assert.equal(pending.status,'asked')
  setApprovalInterpretLlm(async()=>({content:JSON.stringify({verdict:'approve',confidence:1,scope:'this_only',conditions:[],reason:'owner approved this file'})}))
  const done = await approval.handleOwnerAnswer('可以，把這份檔案傳給我。',{contextId:'1001',replyTo:'99'})
  assert.equal(done.executed,true)
  assert.equal(uploads.length,1)
  assert.match(types[0]!,/^multipart\/form-data; boundary=/)
  assert.ok(uploads[0]!.includes(bytes))
  assert.ok(uploads[0]!.includes(Buffer.from('filename="交接.md"')))
  assert.match(uploads[0]!.toString(),/name="chat_id"\r\n\r\n1001/)
  assert.match(uploads[0]!.toString(),/"message_id":42/)
  assert.equal(standingGrants().length,0)
  // Task context selects its own workspace, never the direct conversation directory.
  const taskWs=join(root,'task-workspace'); await mkdir(taskWs); await writeFile(join(taskWs,'交接.md'),'TASK_BYTES')
  const execution={instanceId:'A',taskId:'T',operationId:'O',workspace:taskWs}
  const sent=await dispatch(action,{context:{origin:'interactive',execution},preApproved:true})
  assert.equal(sent.success,true); assert.ok(uploads[1]!.includes(Buffer.from('TASK_BYTES')))
  assert.equal((await runtime.recover(action.type,action.params,execution)).status,'unknown')
  assert.equal(uploads.length,2,'no recovery hook can replay an upload')
})

test('ambiguous upload is not retried and missing receipts do not report sent', async t => {
  await fixture(t)
  let calls=0
  const api=new BotApiTransport({token:'fixture',post:async()=>{calls++;throw Object.assign(new Error('redacted'),{name:'TimeoutError'})}})
  const opts={contextId:'1001',filename:'note.md',bytes:Buffer.from('private bytes')}
  const failure=await api.sendDocument(opts)
  assert.equal(calls,1);assert.equal(failure.sent,false);assert.equal(failure.ambiguous,true)
  const noReceipt=new BotApiTransport({token:'fixture',post:async()=>({status:200,json:()=>({ok:true,result:{}})})})
  assert.equal((await noReceipt.sendDocument(opts)).sent,false)
  setTransport({sendMessage:async()=>({message_id:'1'}),fetchUpdates:async()=>({messages:[],count:0}),sendDocument:async()=>failure})
  const root=await mkdtemp(join(tmpdir(),'doc-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'note.md'),'x')
  assert.equal((await sendFile({path:'note.md',context_id:'1001'},undefined,root)).ok,false)
})

test('multipart proxy retains dispatcher and lets fetch set the boundary header', async () => {
  const { ProxyAgent } = await import('undici')
  let dispatcher: InstanceType<typeof ProxyAgent> | undefined
  const form = new FormData(); form.set('document',new Blob(['bytes']),'note.md')
  const post = createFetchHttpPost({ proxy:'http://127.0.0.1:9999',fetch:async (_url,init)=>{
    assert.notEqual(init.body,form)
    assert.equal((init.body as FormData).get('document') instanceof Blob,true)
    assert.equal(init.headers['content-type'],undefined)
    assert.ok(init.dispatcher instanceof ProxyAgent)
    dispatcher=init.dispatcher
    return {status:200,text:async()=>'{"ok":true}'}
  } })
  try { await post('https://example.invalid/upload',form,{}) } finally { await dispatcher?.close() }
})


test('proxy-selected external undici serializes multipart bytes instead of native FormData text', async t => {
  const { fetch: undiciFetch, ProxyAgent, FormData: ClientFormData } = await import('undici')
  let received = Buffer.alloc(0), contentType = '', dispatcher: InstanceType<typeof ProxyAgent> | undefined
  const server = createServer(async (req, res) => {
    const chunks: Buffer[]=[]; for await(const b of req) chunks.push(Buffer.from(b))
    received=Buffer.concat(chunks); contentType=String(req.headers['content-type'])
    res.end('{"ok":true,"result":{"message_id":77}}')
  })
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  t.after(()=>{server.closeAllConnections();server.close()})
  const post=createFetchHttpPost({proxy:'http://127.0.0.1:9999',fetch:async(url,init)=>{
    assert.ok(init.dispatcher instanceof ProxyAgent);dispatcher=init.dispatcher
    // Use the real external serializer against loopback, without an external proxy.
    const {dispatcher: _proxy,body,...wire}=init
    assert.ok(body instanceof ClientFormData)
    return await undiciFetch(url,{...wire,body})
  }})
  const form=new FormData();form.set('chat_id','1001');form.set('document',new Blob(['# 交接\r\n']), '交接.md')
  try { await post(`http://127.0.0.1:${(server.address() as {port:number}).port}`,form,{}) }
  finally {await dispatcher?.close()}
  assert.match(contentType,/^multipart\/form-data; boundary=/)
  assert.ok(received.includes(Buffer.from('# 交接\r\n')))
  assert.ok(received.includes(Buffer.from('filename="交接.md"')))
  assert.ok(received.includes(Buffer.from('name="chat_id"\r\n\r\n1001')))
  assert.notEqual(received.toString(),'[object FormData]')
})
