const $ = id => document.getElementById(id)
const names = { overview: '概览', chat: '对话', tasks: '任务', mind: 'Mind', skills: '方法库', capabilities: '能力与器官' }
const statusNames = { pending: '待推进', running: '执行中', waiting: '等待中', paused: '已暂停', completed: '已完成', cancelled: '已取消', failed: '失败', open: '未解', resolved: '已解决', released: '已归档', sent: '已送达', sending: '发送中', unknown: '待核实' }
let state, page, skillOffset = null, refreshInFlight = false, historyKey = '', taskKey = '', mindKey = '', capabilityKey = '', chatPending = false
function el(tag, className, ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child))
  return node
}
const empty = text => el('div', 'empty', text)
const badge = status => el('span', 'badge' + (['waiting', 'paused', 'unknown'].includes(status) ? ' warning' : status === 'failed' ? ' failed' : ''), statusNames[status] ?? status)
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'
const short = text => text && text.length > 130 ? text.slice(0, 130) + '…' : text || ''
function button(label, action, className = 'secondary') {
  const node = el('button', className, label); node.type = 'button'
  node.addEventListener('click', () => run(async () => {
    node.disabled = true
    try { await action() } finally { node.disabled = false }
  })); return node
}
function facts(values) {
  return el('dl', 'facts', Object.entries(values).flatMap(([key, value]) => [el('dt', '', key), el('dd', '', value ?? '—')]))
}
function details(label, data) { return el('details', '', el('summary', '', label), el('pre', '', JSON.stringify(data, null, 2))) }
async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}
function notice(id, message) { $(id).textContent = message; $(id).hidden = !message }
async function run(action) {
  try { notice('error', ''); await action() }
  catch (error) {
    if ($('detail').open) {
      $('detail-content').querySelector('[role="alert"]')?.remove()
      const message = el('p', 'notice error', error.message); message.setAttribute('role', 'alert')
      $('detail-content').prepend(message)
    } else notice('error', error.message)
  }
}
function showDetail(title, ...content) {
  $('detail-title').textContent = title; $('detail-content').replaceChildren(...content)
  if (!$('detail').open) $('detail').showModal()
}
$('detail-close').onclick = () => $('detail').close()
function taskRow(task) {
  return el('div', 'row', el('div', '', el('p', 'row-title', short(task.goal)), el('p', 'row-note', short(task.wait?.detail || task.checkpoint || '等待下一步进展'))), badge(task.status))
}
function renderOverview() {
  const tasks = state.tasks ?? [], records = state.mind?.records ?? [], active = tasks.filter(t => !['completed', 'cancelled', 'failed'].includes(t.status))
  $('task-count').textContent = active.length
  $('metrics').replaceChildren(...[
    ['进行中的任务', state.tasks === null ? '—' : active.length, '持久推进 · 前后台共享'],
    ['未解的问题', state.mind === null ? '—' : records.filter(r => r.open).length, '当前 Mind 工作集'],
    ['已注册能力', state.capabilities.length, `${state.organs.length} 个在位器官`],
    ['近期方法', state.skills === null ? '—' : state.skills.length, '最近保存的 10 个方法'],
  ].map(([label, value, note]) => el('div', 'metric', el('span', 'metric-label', label), el('strong', 'metric-number', value), el('span', 'metric-note', note))))
  $('overview-tasks').replaceChildren(...(active.length ? active.slice(0, 3).map(taskRow) : [empty(state.tasks === null ? 'Task 插件未装配。' : '当前没有进行中的任务。')]))
  const thoughts = records.filter(r => r.open).slice(0, 3)
  $('overview-mind').replaceChildren(...(thoughts.length ? thoughts.map(r => el('div', 'row', el('div', '', el('p', 'row-title', r.topic), el('p', 'row-note', short(r.understanding))))) : [empty(state.mind === null ? 'Mind 未装配。' : '当前工作集中没有未解问题。')]))
  $('heart').replaceChildren(...(state.heart ? [el('p', 'row-note', '下一次预计心跳'), el('div', 'heart-time', state.heart.nextAt ? new Date(state.heart.nextAt).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未排定'), el('p', 'row-note', state.heart.nextAt ? new Date(state.heart.nextAt).toLocaleDateString('zh-CN') : '等待 Heart 给出下一拍'), el('hr'), facts({ '待处理拍数': state.heart.pending, '数据来源': 'Heart 服务' })] : [empty('Heart 插件未装配。')]))
  const instance = state.instance
  $('instance-chip').textContent = instance?.id ?? '未绑定实例'
  $('instance').replaceChildren(instance ? facts({ '实例': instance.id, '出生方式': instance.origin === 'created' ? '新建' : '接管', '创建时间': date(instance.createdAt), '定义版本': instance.definitionHash.slice(0, 16), '状态目录': instance.stateRoot }) : empty('当前 Runtime 未绑定 Character Instance。'))
}
function renderChat() {
  const key = JSON.stringify(state.history)
  if (historyKey === key) return
  historyKey = key
  const area = $('chat-history'), atBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 80
  const messages = []
  for (const row of state.history) {
    let entry
    try { entry = JSON.parse(row.content) } catch { messages.push(el('p', 'chat-system', `历史回合 ${row.id} 无法解析`)); continue }
    if (typeof entry.user === 'string') messages.push(chatMessage('user', entry.user, date(row.ts)))
    const replies = Array.isArray(entry.utterances) ? entry.utterances : [entry.reply]
    for (const reply of replies) if (typeof reply === 'string' && reply) messages.push(chatMessage('assistant', reply, date(row.ts)))
    if (!entry.reply) messages.push(el('p', 'chat-system', '本回合无文字回复；历史记录不代表消息已送达。'))
  }
  area.replaceChildren(...(messages.length ? messages : [empty('还没有对话记录。从一句话开始。')]))
  if (atBottom || chatPending) area.scrollTop = area.scrollHeight
}
function chatMessage(role, text, time) {
  return el('div', 'chat-message ' + role, el('div', 'chat-label', `${role === 'user' ? '你' : state?.instance?.id ?? '实例'} · ${time}`), el('div', 'chat-bubble', text))
}
async function taskCommand(command, id, text) {
  const result = await api('task', { command, id, text }); notice('receipt', result.receipt); await refresh()
}
function renderTasks() {
  const key = JSON.stringify(state.tasks)
  if (taskKey === key) return
  taskKey = key
  $('task-form').hidden = state.tasks === null
  $('task-list').replaceChildren(...(state.tasks?.length ? [...state.tasks].reverse().map(task => {
    const controls = [button('详情与操作记录', () => taskDetail(task.id))]
    if (!['completed', 'cancelled'].includes(task.status)) {
      controls.push(button('修改要求', () => editTask(task)))
      if (task.status === 'paused') controls.push(button('继续', () => taskCommand('resume', task.id)))
      else if (['pending', 'running', 'waiting'].includes(task.status)) controls.push(button('暂停', () => taskCommand('pause', task.id)))
      controls.push(button('取消任务', async () => { if (confirm('取消这个任务？已经发生的外部操作不会撤销。')) await taskCommand('cancel', task.id) }, 'danger'))
    }
    if (task.delivery?.state === 'failed') controls.push(button('重试送达', () => taskCommand('retry-delivery', task.id)))
    return el('article', 'card', el('div', 'card-heading', el('h2', 'task-title', task.goal), badge(task.status)),
      el('div', 'task-meta', el('span', '', task.origin === 'autonomous' ? '自主任务' : '用户任务'), el('span', '', task.id)),
      el('p', 'body-text', task.wait?.detail || task.checkpoint || '尚无进展记录'),
      task.scheduledMessage ? el('p', 'row-note', '计划时间：' + date(task.scheduledMessage.dueAt)) : null,
      task.delivery ? el('p', 'row-note', '成果送达：', badge(task.delivery.state)) : null,
      task.result ? el('details', '', el('summary', '', '查看成果'), el('div', 'body-text', task.result)) : null,
      el('div', 'actions', controls))
  }) : [empty(state.tasks === null ? 'Task 插件未装配。' : '还没有任务。你可以在上方创建，或在对话里提出要求。')]))
}
function editTask(task) {
  const field = el('textarea'); field.rows = 8; field.value = task.requirements
  field.setAttribute('aria-label', '完整最新要求')
  showDetail('修改任务要求', el('p', 'row-note', '填写完整最新要求；保存不会自动恢复暂停中的任务。'), field,
    el('div', 'actions', button('保存要求', async () => { await taskCommand('update', task.id, field.value); $('detail').close() })))
}
async function taskDetail(id, start = 0, previous = []) {
  const result = await api('task?id=' + encodeURIComponent(id) + '&offset=' + start), task = result.task
  const operations = [...previous, ...result.operations]
  showDetail(task.goal, facts({ '状态': statusNames[task.status] ?? task.status, '要求': task.requirements, '等待': task.wait?.detail, '成果': task.result, '送达': task.delivery?.state }),
    el('h2', 'section-title', '操作记录'),
    ...operations.map(op => el('article', 'card', el('div', 'card-heading', el('h2', '', op.name), badge(op.status)), details('参数与回执', op),
      task.wait?.kind === 'approval' && task.wait.operationId === op.id ? el('div', 'actions', button('批准这次操作', async () => { if (confirm('确认已核对这次操作的参数并批准执行？')) { await taskCommand('approve', op.id); await taskDetail(id) } })) : null)),
    operations.length ? el('div') : empty('还没有执行记录。'),
    ...(result.nextOffset !== null ? [button('加载更多操作', () => taskDetail(id, result.nextOffset, operations))] : []))
}
function renderMind(view) {
  const key = JSON.stringify(view)
  if (mindKey === key) return
  mindKey = key
  $('mind-list').replaceChildren(...(view?.records.length ? view.records.map(r => el('article', 'card',
    el('div', 'card-heading', el('h2', '', r.topic), badge(({ preference: '情境偏好', self: '后天自我', moment: '短期关系态' })[r.kind] ?? r.status)),
    el('div', 'body-text', r.understanding), r.open ? el('p', 'row-note', '尚未解决：' + r.open) : null,
    el('div', 'task-meta', `版本 ${r.revision}`, date(r.updatedAt), r.expiresAt ? `有效至 ${date(r.expiresAt)}` : '', r.kind === 'preference' ? (r.basis === 'explicit' ? '明确表达' : '推断') : ''),
    details('来源与适用情境', { evidence: r.evidence, links: r.links, scope: r.scope, reconsiderAt: r.reconsiderAt }))) : [empty(view === null ? 'Mind 未装配。' : '没有匹配的理解记录。')]))
  $('mind-events').replaceChildren(...(view?.events.length ? view.events.map(event => el('article', 'card', el('div', 'task-meta', event.source, date(event.createdAt)), el('div', 'body-text', event.content), el('p', 'row-note', event.reference))) : [empty('没有待处理事件。')]))
}
async function searchSkills(next = false) {
  const result = await api('skills?query=' + encodeURIComponent($('skill-query').value) + '&offset=' + (next ? skillOffset : 0))
  if (!next) $('skill-list').replaceChildren()
  $('skill-list').append(...result.skills.map(skill => el('article', 'card', el('div', 'card-heading', el('h2', '', skill.title), button('阅读全文 ↗', async () => {
    const full = await api('skills?id=' + encodeURIComponent(skill.id))
    showDetail(full.title, el('p', 'row-note', `版本 ${full.revision} · ${date(full.updatedAt)}`), el('div', 'body-text', full.body), details('来源', full.source))
  })), el('p', 'body-text', skill.summary))))
  for (const error of result.errors) $('skill-list').append(empty(`方法 ${error.id} 读取失败：${error.error}`))
  if (!$('skill-list').children.length) $('skill-list').append(empty(result.nextOffset === null ? '没有匹配的方法。' : '本页无匹配，可以继续查找下一页。'))
  skillOffset = result.nextOffset; $('skill-more').hidden = skillOffset === null
}
function renderCapabilities() {
  const key = JSON.stringify([state.revision, state.capabilities, state.organs])
  if (capabilityKey === key) return
  capabilityKey = key
  $('cap-revision').textContent = 'REVISION ' + state.revision
  $('capability-list').replaceChildren(...(state.organs.length ? state.organs.map(organ => el('article', 'card',
    el('div', 'card-heading', el('h2', '', organ.organId), el('span', 'tag', `${organ.actions.length} 个能力`)),
    ...organ.actions.map(name => { const capability = state.capabilities.find(c => c.name === name); return el('div', 'row', el('div', '', el('p', 'row-title', name), el('p', 'row-note', capability?.description), details('输入结构', capability?.inputSchema))) }),
    organ.sideEffects.length ? details('已声明副作用', organ.sideEffects) : null)) : [empty('尚无注册能力。')]))
}
async function refresh() {
  if (refreshInFlight) return
  refreshInFlight = true
  try {
    state = await api('state'); $('chat-image').disabled = !state.visionAvailable; $('chat-image').title = state.visionAvailable ? '附加一张图片' : '当前实例未接入视觉模型'
    $('connection').textContent = '运行时已连接'; $('connection').classList.remove('offline')
    $('updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
    renderOverview(); renderChat()
    if (page === 'tasks') renderTasks()
    if (page === 'mind' && !$('mind-query').value) renderMind(state.mind)
    if (page === 'capabilities') renderCapabilities()
  } catch (error) {
    $('connection').textContent = '连接中断 · 显示上次快照'; $('connection').classList.add('offline'); throw error
  } finally { refreshInFlight = false }
}
async function navigate() {
  page = Object.hasOwn(names, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'
  document.querySelectorAll('.page').forEach(node => { node.hidden = node.id !== page })
  document.querySelectorAll('nav a').forEach(node => { const active = node.hash === '#' + page; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current') })
  $('page-name').textContent = names[page]
  if (!state) await refresh()
  if (page === 'tasks') renderTasks()
  if (page === 'mind') renderMind($('mind-query').value ? await api('mind?query=' + encodeURIComponent($('mind-query').value)) : state.mind)
  if (page === 'skills') { if (state.skills === null) $('skill-list').replaceChildren(empty('Skill 插件未装配。')); else await searchSkills() }
  if (page === 'capabilities') renderCapabilities()
}
$('chat-form').onsubmit = event => { event.preventDefault(); if (chatPending || !$('chat-text').value.trim()) return; run(async () => {
  const message = $('chat-text').value, submit = $('chat-form').querySelector('button')
  chatPending = true; submit.disabled = true; $('chat-status').textContent = '已提交，等待本轮结果…'
  try {
    const file = $('chat-image').files[0]
    let image
    if (file) {
      if (file.size > 8 * 1024 * 1024) throw new Error('图片不能超过 8 MiB')
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('无法读取图片')); reader.readAsDataURL(file) })
      image = { data, mediaType: file.type }
    }
    const result = await api(image ? 'chat/image' : 'chat', { text: message, ...(image ? { image } : {}) })
    $('chat-image').value = ''
    if ($('chat-text').value === message) $('chat-text').value = ''
    const kind = result.outcome?.kind
    $('chat-status').textContent = ({ reply: '本轮已返回', silence: '本轮选择了沉默', followup: '后续任务已登记', ask_pending: '操作未执行，未能建立审批', envelope_failed: '本轮信封失败', missing_tool: '所需能力不可用', tool_budget: '本轮工具步数已用完' })[kind] ?? '本轮已结束'
    if (result.approvalStatus) $('chat-status').textContent = ['asked', 'already_pending'].includes(result.approvalStatus)
      ? '审批已在绑定通道建立，请在那里答复。操作尚未执行。'
      : result.approvalStatus === 'quiet_period' ? '近期拒绝仍然生效，操作未执行，也未新建审批。' : '审批通道不可用，操作未执行。'
    await refresh()
  } catch (error) { $('chat-status').textContent = '请求未确认。请先检查历史与任务，避免重复提交。'; throw error }
  finally { chatPending = false; submit.disabled = false }
}) }
$('chat-text').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit() } }
$('task-form').onsubmit = event => { event.preventDefault(); run(async () => { const submit = $('task-form').querySelector('button'); submit.disabled = true; try { await taskCommand('create', '', $('task-text').value); $('task-text').value = '' } finally { submit.disabled = false } }) }
$('mind-search').onsubmit = event => { event.preventDefault(); run(async () => renderMind(await api('mind?query=' + encodeURIComponent($('mind-query').value)))) }
$('skill-search').onsubmit = event => { event.preventDefault(); run(() => searchSkills()) }
$('skill-more').onclick = () => run(() => searchSkills(true))
$('refresh').onclick = () => run(refresh)
window.addEventListener('hashchange', () => run(navigate))
document.addEventListener('visibilitychange', () => { if (!document.hidden) run(refresh) })
setInterval(() => { if (!document.hidden) refresh().catch(error => notice('error', error.message)) }, 5000)
run(navigate)
