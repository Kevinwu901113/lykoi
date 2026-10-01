const $ = (id) => document.getElementById(id)
const labels = { transform: '转换', core: '计算', tool: '工具', wait: '等待' }
const statuses = {
  queued: '排队中',
  running: '运行中',
  waiting: '等待输入 / 核验',
  paused: '已暂停',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消'
}
let catalog = [],
  versions = [],
  instances = [],
  selected = '',
  revision = 0,
  dirty = true,
  runId = '',
  currentRun,
  polling = false
const blank = () => ({
  id: `agent_${crypto.randomUUID().slice(0, 8)}`,
  name: '我的 Agent',
  nodes: [],
  edges: [],
  output: '',
  resources: [
    { id: 'model', type: 'model', config: { provider: 'demo' } },
    { id: 'workspace', type: 'workspace', config: {} }
  ],
  execution: { mode: 'single', maxActions: 4, timeoutMs: 60000 }
})
let draft = blank()
function el(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}
function note(text, error = false) {
  $('notice').textContent = text
  $('notice').className = error ? 'error' : ''
}
async function api(path, body) {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  )
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? '请求失败')
  return result
}
function action(id, fn) {
  $(id).addEventListener('click', () =>
    Promise.resolve()
      .then(fn)
      .catch((error) => note(error.message, true))
  )
}
function spec(node) {
  const found = catalog.find((c) => c.id === node.component && c.version === node.version)
  if (!found) throw new Error(`组件未安装：${node.component}@${node.version}`)
  return found
}
function changed() {
  dirty = true
  $('revision').textContent = revision ? `v${revision} · 有未保存修改` : '未保存'
  updateAdmission()
}
function updateAdmission() {
  $('run').disabled = dirty || !$('instances').value
  $('create-instance').disabled = dirty || !revision
  $('run-hint').textContent = dirty
    ? '有未保存修改。保存新版本后再运行。'
    : `运行将固定使用 v${revision}；之后的修改不会改变本次运行。`
}
function choices(select, values, current, placeholder) {
  select.replaceChildren()
  if (placeholder !== undefined) {
    const option = el('option', placeholder)
    option.value = ''
    select.add(option)
  }
  for (const [value, title] of values) {
    const option = el('option', title)
    option.value = value
    select.add(option)
  }
  select.value = current ?? ''
}
function renderGraph() {
  $('nodes').replaceChildren()
  $('empty').hidden = draft.nodes.length > 0
  for (const node of draft.nodes) {
    const s = spec(node),
      button = el('button', undefined, `node${selected === node.id ? ' selected' : ''}`)
    button.dataset.node = node.id
    button.dataset.kind = s.kind
    const top = el('div', undefined, 'node-top')
    top.append(el('strong', s.title), el('span', labels[s.kind], 'node-kind'))
    button.append(top, el('small', `${node.id} / ${node.component}@${node.version}`))
    if (s.kind !== 'tool') button.append(el('span', undefined, 'port in'), el('span', undefined, 'port out'))
    button.onclick = () => {
      selected = node.id
      renderGraph()
      renderInspector()
    }
    $('nodes').append(button)
  }
  $('graph-info').textContent = `${draft.nodes.length} 个组件 · ${draft.edges.length} 条连接`
  choices(
    $('output'),
    draft.nodes.filter((n) => spec(n).kind !== 'tool').map((n) => [n.id, `${n.id} · ${spec(n).title}`]),
    draft.output
  )
  requestAnimationFrame(drawEdges)
}
function drawEdges() {
  const svg = $('edges'),
    root = $('canvas').getBoundingClientRect()
  svg.replaceChildren()
  for (const edge of draft.edges) {
    const from = [...$('nodes').children].find((n) => n.dataset.node === edge.from),
      to = [...$('nodes').children].find((n) => n.dataset.node === edge.to)
    if (!from || !to) continue
    const a = from.getBoundingClientRect(),
      b = to.getBoundingClientRect()
    const x1 = a.right - root.left,
      y1 = a.top + a.height / 2 - root.top,
      x2 = b.left - root.left,
      y2 = b.top + b.height / 2 - root.top
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const bend = Math.max(25, Math.abs(y2 - y1) / 3)
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`)
    svg.append(path)
  }
}
function field(parent, label, input) {
  const wrapper = el('label', label)
  wrapper.append(input)
  parent.append(wrapper)
  return input
}
function renderInspector() {
  const root = $('inspector')
  root.replaceChildren()
  const node = draft.nodes.find((n) => n.id === selected)
  if (!node) {
    root.append(el('p', '选择画布中的组件进行配置。', 'muted'))
    return
  }
  const s = spec(node)
  root.append(
    el('h2', s.title),
    el('p', s.description, 'muted small'),
    el('small', `${node.id} · ${s.version}`, 'muted')
  )
  const config = field(root, '配置 / JSON', el('textarea'))
  config.value = JSON.stringify(node.config, null, 2)
  config.id = 'node-config'
  config.oninput = () => {
    changed()
    try {
      const value = JSON.parse(config.value)
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('配置必须为 JSON 对象')
      node.config = value
      config.setCustomValidity('')
    } catch {
      config.setCustomValidity('请输入合法 JSON 对象')
    }
  }
  if (s.kind !== 'tool') {
    const upstream = field(root, '输入来源', el('select'))
    choices(
      upstream,
      draft.nodes
        .filter((n) => n.id !== node.id && spec(n).kind !== 'tool')
        .map((n) => [n.id, `${n.id} · ${spec(n).title}`]),
      draft.edges.find((e) => e.to === node.id)?.from,
      '本次运行输入'
    )
    upstream.onchange = () => {
      draft.edges = draft.edges.filter((e) => e.to !== node.id)
      if (upstream.value) draft.edges.push({ from: upstream.value, to: node.id })
      changed()
      renderGraph()
    }
  }
  for (const [role, type] of Object.entries(s.resourceRoles)) {
    const select = field(root, `资源绑定 / ${role}`, el('select'))
    choices(
      select,
      draft.resources.filter((r) => r.type === type).map((r) => [r.id, r.id]),
      node.resources[role],
      '请选择资源'
    )
    select.onchange = () => {
      node.resources[role] = select.value
      changed()
    }
  }
  if (s.kind === 'core') {
    root.append(el('p', 'Core 可调用的工具', 'muted small'))
    for (const tool of draft.nodes.filter((n) => spec(n).kind === 'tool')) {
      const check = el('input')
      check.type = 'checkbox'
      check.checked = node.tools.includes(tool.id)
      const label = el('label', undefined, 'tool-check')
      label.append(check, el('span', `${tool.id} · ${spec(tool).title}`))
      root.append(label)
      check.onchange = () => {
        node.tools = check.checked ? [...node.tools, tool.id] : node.tools.filter((id) => id !== tool.id)
        changed()
      }
    }
  }
  const remove = el('button', '移除组件', 'delete')
  remove.onclick = () => {
    draft.nodes = draft.nodes.filter((n) => n.id !== node.id)
    draft.edges = draft.edges.filter((e) => e.from !== node.id && e.to !== node.id)
    draft.nodes.forEach((n) => {
      n.tools = n.tools.filter((id) => id !== node.id)
    })
    if (draft.output === node.id)
      draft.output = draft.nodes.filter((n) => spec(n).kind !== 'tool').at(-1)?.id ?? ''
    selected = ''
    changed()
    renderGraph()
    renderInspector()
  }
  root.append(remove)
}
function renderResources() {
  $('resources').replaceChildren()
  for (const resource of draft.resources) {
    const card = el('div', undefined, 'resource-card')
    card.append(el('strong', `${resource.id} / ${resource.type}`))
    if (resource.type === 'model') {
      const provider = field(card, '模型提供方式', el('select'))
      choices(
        provider,
        [
          ['demo', '离线演示'],
          ['openai-compatible', 'OpenAI 兼容接口']
        ],
        resource.config.provider
      )
      provider.onchange = () => {
        resource.config =
          provider.value === 'demo'
            ? { provider: 'demo' }
            : { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-model' }
        changed()
        renderResources()
      }
      if (resource.config.provider === 'openai-compatible') {
        for (const [key, label] of [
          ['baseUrl', '接口地址 / 含 v1'],
          ['model', '模型名'],
          ['credential', '凭证句柄 / 可留空']
        ]) {
          const input = field(card, label, el('input'))
          input.value = resource.config[key] ?? ''
          input.oninput = () => {
            if (input.value || key !== 'credential') resource.config[key] = input.value
            else delete resource.config[key]
            changed()
          }
        }
        card.append(el('p', '只填写句柄；密钥在本机部署配置中提供。', 'muted small'))
      }
    } else card.append(el('p', '工作区由实例创建。同一实例中绑定此资源的组件共享文件。', 'muted small'))
    const remove = el('button', '移除资源')
    remove.onclick = () => {
      draft.resources = draft.resources.filter((r) => r.id !== resource.id)
      changed()
      renderResources()
      renderInspector()
    }
    card.append(remove)
    $('resources').append(card)
  }
}
function renderDraft() {
  $('agent-name').value = draft.name
  $('mode').value = draft.execution.mode
  $('max-actions').value = draft.execution.maxActions
  $('timeout').value = draft.execution.timeoutMs / 1000
  $('revision').textContent = revision ? `v${revision}${dirty ? ' · 有未保存修改' : ' · 已保存'}` : '未保存'
  renderGraph()
  renderInspector()
  renderResources()
  renderInstances()
  updateAdmission()
}
function renderInstances() {
  choices(
    $('instances'),
    instances.filter((i) => i.agentId === draft.id).map((i) => [i.id, `实例 ${i.id.slice(0, 8)}`]),
    $('instances').value,
    '选择运行实例'
  )
  if (!$('instances').value && $('instances').options.length > 1) $('instances').selectedIndex = 1
  updateAdmission()
}
async function refreshDefinitions() {
  versions = await api('definitions')
  instances = await api('instances')
  choices(
    $('saved-agents'),
    versions.map((v) => [v.agentId, `${v.definition.name} · v${v.revision}`]),
    draft.id,
    '选择已保存定义'
  )
  renderInstances()
}
function addNode(s) {
  let index = 1,
    id
  do {
    id = `${s.kind}_${index++}`
  } while (draft.nodes.some((n) => n.id === id))
  const node = {
    id,
    component: s.id,
    version: s.version,
    config: structuredClone(s.defaultConfig),
    resources: {},
    tools: []
  }
  for (const [role, type] of Object.entries(s.resourceRoles))
    node.resources[role] = draft.resources.find((r) => r.type === type)?.id ?? ''
  const previous = draft.nodes.filter((n) => spec(n).kind !== 'tool').at(-1)
  draft.nodes.push(node)
  if (s.kind !== 'tool') {
    if (previous) draft.edges.push({ from: previous.id, to: node.id })
    draft.output = node.id
  }
  selected = node.id
  changed()
  renderGraph()
  renderInspector()
}
action('new', () => {
  draft = blank()
  selected = ''
  revision = 0
  dirty = true
  renderDraft()
  note('已创建空白装配。')
})
action('load-demo', () => {
  draft = blank()
  draft.name = '最小装配示例'
  selected = ''
  revision = 0
  for (const id of ['text.template', 'model.core', 'human.wait', 'output.value'])
    addNode(catalog.find((c) => c.id === id))
  renderDraft()
  note('示例使用离线演示模型，包含一次持久人工等待。可在右侧切换真实模型接口。')
})
action('save', async () => {
  const editor = $('node-config')
  if (editor && !editor.reportValidity()) throw new Error('组件配置 JSON 无效')
  draft.name = $('agent-name').value
  draft.execution = {
    mode: $('mode').value,
    maxActions: Number($('max-actions').value),
    timeoutMs: Number($('timeout').value) * 1000
  }
  draft.output = $('output').value
  const version = await api('definitions', { definition: draft, expectedRevision: revision })
  revision = version.revision
  draft = version.definition
  dirty = false
  await refreshDefinitions()
  renderDraft()
  note(`已保存 v${revision}。正在运行的旧版本保持原定义。`)
})
action('open-agent', () => {
  const version = versions.find((v) => v.agentId === $('saved-agents').value)
  if (!version) throw new Error('请选择已保存的 Agent')
  draft = structuredClone(version.definition)
  revision = version.revision
  dirty = false
  selected = ''
  renderDraft()
  note(`已打开 ${draft.name} v${revision}。`)
})
action('export', () => {
  const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }),
    url = URL.createObjectURL(blob)
  const link = el('a')
  link.href = url
  link.download = `${draft.id}.json`
  link.click()
  URL.revokeObjectURL(url)
})
$('import').onchange = async () => {
  try {
    const file = $('import').files[0]
    if (!file) return
    if (file.size > 1048576) throw new Error('定义文件超过 1 MiB')
    const imported = JSON.parse(await file.text())
    if (
      !Array.isArray(imported.nodes) ||
      !Array.isArray(imported.edges) ||
      !Array.isArray(imported.resources) ||
      !imported.execution
    )
      throw new Error('定义结构不完整')
    imported.nodes.forEach(spec)
    // Import as a new definition, never overwrite another Agent's history accidentally.
    draft = { ...imported, id: blank().id }
    revision = 0
    dirty = true
    selected = ''
    renderDraft()
    note('已导入为新的 Agent。保存时会校验连接和资源。')
  } catch (error) {
    note(error.message, true)
  }
  $('import').value = ''
}
function nextResourceId(type) {
  let index = 1
  while (draft.resources.some((r) => r.id === `${type}_${index}`)) index++
  return `${type}_${index}`
}
action('add-model', () => {
  draft.resources.push({
    id: nextResourceId('model'),
    type: 'model',
    config: { provider: 'demo' }
  })
  changed()
  renderResources()
  renderInspector()
})
action('add-workspace', () => {
  draft.resources.push({ id: nextResourceId('workspace'), type: 'workspace', config: {} })
  changed()
  renderResources()
  renderInspector()
})
action('create-instance', async () => {
  const instance = await api('instances', { agentId: draft.id })
  await refreshDefinitions()
  $('instances').value = instance.id
  updateAdmission()
  note('新实例已创建，运行状态和工作区独立。')
})
action('run', async () => {
  if (dirty) throw new Error('请先保存新版本')
  const run = await api('runs', { instanceId: $('instances').value, input: $('run-input').value })
  runId = run.id
  await observe()
  await refreshHistory()
  note(`运行已创建，固定使用 v${run.version.revision}。`)
})
async function refreshHistory() {
  const runs = await api('runs')
  choices(
    $('run-history'),
    runs.map((r) => [
      r.id,
      `${r.version.definition.name} · v${r.version.revision} · ${statuses[r.status]} · ${r.id.slice(0, 8)}`
    ]),
    runId,
    '选择运行记录'
  )
}
async function observe() {
  if (!runId || polling) return
  polling = true
  try {
    const [{ run, operations }, trace] = await Promise.all([api(`runs/${runId}`), api(`runs/${runId}/trace`)])
    currentRun = run
    $('run-status').textContent = `${statuses[run.status]} · v${run.version.revision}`
    const pending = operations.find((op) => op.id === run.wait?.operationId)
    $('result').textContent =
      JSON.stringify(
        run.result ?? (pending ? { outputs: run.outputs, pendingOperation: pending } : run.outputs),
        null,
        2
      ) + (run.error ? `\n${run.error}` : '')
    $('trace').replaceChildren()
    const names = {
      'run.created': '运行创建',
      'run.started': '运行开始',
      'operation.started': '组件调用',
      'operation.completed': '回执已记录',
      'operation.waiting': '等待输入',
      'operation.unknown': '结果待核验',
      'node.completed': '节点完成',
      'run.waiting': '运行等待',
      'operation.resolved': '收到结果',
      'run.succeeded': '运行完成',
      'run.failed': '运行失败',
      'run.paused': '已暂停',
      'run.resumed': '已继续',
      'run.cancelled': '已取消'
    }
    for (const event of trace) {
      const li = el('li', names[event.type] ?? event.type)
      li.append(
        el(
          'small',
          `${new Date(event.at).toLocaleTimeString()}${event.data.nodeId ? ` / ${event.data.nodeId}` : ''}`
        )
      )
      $('trace').append(li)
    }
    const finished = ['succeeded', 'failed', 'cancelled'].includes(run.status)
    $('pause').disabled = finished || run.status === 'paused'
    $('resume').disabled = run.status !== 'paused' || !!run.wait
    $('cancel').disabled = finished
    $('wait-box').hidden = !run.wait
    if (run.wait) {
      $('wait-prompt').textContent = run.wait.prompt
      $('wait-help').textContent =
        run.wait.reason === 'unknown'
          ? '此操作不会自动重做。请先核验实际结果，再提交确认的回执；模型回执格式为 {"kind":"finish","result":"实际结果"}。'
          : '上游结果显示在右侧。此等待会保存，服务重启后仍可继续。'
      $('resolve').textContent = run.status === 'paused' ? '提交结果（保持暂停）' : '提交结果并继续'
    }
  } finally {
    polling = false
  }
}
for (const command of ['pause', 'resume', 'cancel'])
  action(command, async () => {
    if (!runId) throw new Error('请选择运行')
    await api(`runs/${runId}/${command}`, {})
    await observe()
    await refreshHistory()
  })
action('resolve', async () => {
  if (!currentRun?.wait) throw new Error('当前运行没有等待操作')
  const value = $('wait-json').checked ? JSON.parse($('wait-value').value) : $('wait-value').value
  await api(`runs/${runId}/resolve`, { operationId: currentRun.wait.operationId, value })
  $('wait-value').value = ''
  await observe()
  await refreshHistory()
})
$('run-history').onchange = () => {
  runId = $('run-history').value
  void observe().catch((error) => note(error.message, true))
}
$('instances').onchange = updateAdmission
$('agent-name').oninput = () => {
  draft.name = $('agent-name').value
  changed()
}
for (const id of ['mode', 'max-actions', 'timeout', 'output'])
  $(id).onchange = () => {
    draft.execution = {
      mode: $('mode').value,
      maxActions: Number($('max-actions').value),
      timeoutMs: Number($('timeout').value) * 1000
    }
    draft.output = $('output').value
    changed()
  }
new ResizeObserver(drawEdges).observe($('canvas'))
try {
  catalog = await api('catalog')
  for (const s of catalog) {
    const button = el('button', undefined, 'catalog-card')
    const title = el('strong', s.title)
    title.append(el('span', labels[s.kind], 'kind'))
    button.append(title, el('small', s.description))
    button.onclick = () => addNode(s)
    $('catalog').append(button)
  }
  await refreshDefinitions()
  renderDraft()
  await refreshHistory()
} catch (error) {
  note(`无法连接工作台：${error.message}`, true)
}
setInterval(() => {
  if (runId) void observe().catch((error) => note(error.message, true))
}, 1500)
