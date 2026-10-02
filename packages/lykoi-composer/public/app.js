import {
  NODE_WIDTH,
  NODE_HEIGHT,
  PORT_Y,
  clamp,
  connectionError,
  arrangeGraph,
  toWorld,
  zoomViewport,
  fitViewport,
  wirePath,
  branches,
  edgeKey,
  portY,
  inWorkflow
} from './graph-editor.js'
const $ = (id) => document.getElementById(id)
const labels = {
  transform: '转换',
  core: '计算',
  decision: '决策',
  control: '控制',
  tool: '工具',
  wait: '等待'
}
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
let currentOperations = []
let waitFormOperation = ''
let selectedEdge = '',
  connection = null,
  gesture = null,
  spaceHeld = false,
  addPoint = null
let historyPast = [],
  historyFuture = [],
  lastSnapshot = JSON.stringify(draft)
const invalidConfigs = new Map()
const icons = {
  transform: '≋',
  core: '✦',
  decision: '⎇',
  control: '⑂',
  tool: '⌘',
  wait: '◷'
}
function editor() {
  draft.editor ??= {
    positions: arrangeGraph(draft, spec),
    viewport: { x: 0, y: 0, zoom: 1 }
  }
  const fallback = arrangeGraph(draft, spec)
  for (const node of draft.nodes)
    draft.editor.positions[node.id] ??= fallback[node.id]
  return draft.editor
}
function resetHistory() {
  invalidConfigs.clear()
  historyPast = []
  historyFuture = []
  lastSnapshot = JSON.stringify(draft)
  selectedEdge = ''
  connection = null
  updateHistory()
}
function updateHistory() {
  $('undo').disabled = !historyPast.length
  $('redo').disabled = !historyFuture.length
}
function remember() {
  const snapshot = JSON.stringify(draft)
  if (snapshot !== lastSnapshot) {
    historyPast.push(lastSnapshot)
    if (historyPast.length > 60) historyPast.shift()
    historyFuture = []
    lastSnapshot = snapshot
  }
  updateHistory()
}
function setDrawer(name) {
  for (const [panel, button] of [
    ['library', 'show-library'],
    ['agents-panel', 'show-agents'],
    ['settings-panel', 'show-settings']
  ]) {
    $(panel).hidden = panel !== name
    $(button).classList.toggle('active', panel === name)
    $(button).setAttribute('aria-expanded', String(panel === name))
  }
  if (name === 'library') $('component-search').focus()
}
function openDock(open = true) {
  $('run-content').hidden = !open
  document.body.classList.toggle('run-open', open)
  $('toggle-run').setAttribute('aria-expanded', String(open))
  $('dock-chevron').textContent = open ? '⌄' : '⌃'
}

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
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        }
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
  const found = catalog.find(
    (c) => c.id === node.component && c.version === node.version
  )
  if (!found) throw new Error(`组件未安装：${node.component}@${node.version}`)
  return found
}
function changed() {
  remember()
  dirty = true
  $('revision').textContent = revision
    ? `v${revision} · 有未保存修改`
    : '未保存'
  updateAdmission()
  renderNodeStates()
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
  const geometry = editor()
  $('nodes').replaceChildren()
  $('empty').hidden = draft.nodes.length > 0
  for (const node of draft.nodes) {
    const s = spec(node),
      card = el(
        'article',
        undefined,
        `node${selected === node.id ? ' selected' : ''}`
      )
    card.dataset.node = node.id
    card.dataset.kind = s.kind
    card.style.left = `${geometry.positions[node.id].x}px`
    card.style.top = `${geometry.positions[node.id].y}px`
    const top = el('div', undefined, 'node-top')
    top.append(
      el('span', icons[s.kind], 'catalog-icon'),
      el('strong', s.title),
      el('span', labels[s.kind], 'node-kind')
    )
    top.setAttribute('role', 'button')
    top.tabIndex = 0
    top.setAttribute('aria-label', `配置 ${node.id} ${s.title}`)
    top.onclick = () => selectNode(node.id)
    top.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectNode(node.id)
      }
    }
    top.onpointerdown = (event) => {
      if (event.button !== 0 || spaceHeld) return
      event.preventDefault()
      event.stopPropagation()
      selected = node.id
      selectedEdge = ''
      renderInspector()
      for (const peer of $('nodes').children)
        peer.classList.toggle('selected', peer.dataset.node === selected)
      const start = point(event),
        position = { ...geometry.positions[node.id] }
      gesture = {
        kind: 'node',
        id: node.id,
        start,
        position,
        pointerId: event.pointerId,
        moved: false
      }
      $('canvas').setPointerCapture?.(event.pointerId)
    }
    card.append(top, el('small', `${node.id} · ${s.version}`, 'node-id'))
    if (inWorkflow(node, s)) {
      const ports = el('div', undefined, 'node-ports')
      ports.append(
        el('span', `输入 / ${s.input === 'text' ? '文本' : 'JSON'}`),
        el('span', `输出 / ${s.output === 'text' ? '文本' : 'JSON'}`)
      )
      card.append(ports)
      const exits = branches(node)
      card.style.minHeight = `${Math.max(NODE_HEIGHT, PORT_Y + exits.length * 24 + 62)}px`
      for (const [direction, branch] of [
        ...(node.component === 'flow.input' ? [] : [['in', undefined]]),
        ...exits.map((id) => ['out', id])
      ]) {
        const port = el('button', undefined, `port ${direction}`)
        port.dataset.port = direction
        port.dataset.owner = node.id
        if (branch) port.dataset.branch = branch
        port.style.top = `${(direction === 'out' ? portY(node, branch) : PORT_Y) - 8}px`
        if (branch) {
          const label = el('span', branch, 'branch-port-label')
          label.style.top = `${portY(node, branch) - 9}px`
          card.append(label)
        }
        port.setAttribute(
          'aria-label',
          `${node.id} ${direction === 'in' ? '输入' : '输出'}端口${branch ? ' ' + branch : ''}`
        )
        if (direction === 'out') {
          port.classList.toggle(
            'armed',
            connection?.from === node.id && connection?.branch === branch
          )
          port.onpointerdown = (event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            startConnection(node.id, branch)
            gesture = {
              kind: 'wire',
              start: point(event),
              pointerId: event.pointerId,
              moved: false
            }
            $('canvas').setPointerCapture?.(event.pointerId)
          }
          port.onclick = (event) => {
            event.stopPropagation()
            if (connection?.from !== node.id || connection?.branch !== branch)
              startConnection(node.id, branch)
          }
        } else
          port.onclick = (event) => {
            event.stopPropagation()
            if (connection)
              connectNodes(connection.from, node.id, connection.branch)
            else selectNode(node.id)
          }
        card.append(port)
      }
    } else card.append(el('div', '由 Core 工具绑定调用', 'node-ports'))
    const summary = el('div', undefined, 'node-summary')
    summary.textContent =
      s.kind === 'core'
        ? `模型 · ${node.resources.model || '未绑定'} / ${node.tools.length} 个工具`
        : s.kind === 'tool'
          ? `工作区 · ${Object.values(node.resources)[0] || '未绑定'}`
          : String(
              node.config.template ??
                node.config.prompt ??
                (node.component === 'model.decision'
                  ? '决策 · ' + node.resources.model
                  : node.component === 'flow.branch'
                    ? branches(node).join(' / ')
                    : '将上游结果作为输出')
            )
    card.append(summary)
    if (draft.output === node.id)
      card.append(el('span', '最终输出', 'node-output'))
    $('nodes').append(card)
  }
  $('graph-info').textContent =
    `${draft.nodes.length} 个组件 · ${draft.edges.length} 条连接`
  choices(
    $('output'),
    draft.nodes
      .filter((n) => inWorkflow(n, spec(n)))
      .map((n) => [n.id, `${n.id} · ${spec(n).title}`]),
    draft.output
  )
  applyViewport()
  drawEdges()
  renderNodeStates()
}
function selectNode(id) {
  selected = id
  selectedEdge = ''
  for (const card of $('nodes').children)
    card.classList.toggle('selected', card.dataset.node === id)
  renderInspector()
  drawEdges()
}
function point(event) {
  const bounds = $('canvas').getBoundingClientRect()
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
}
function applyViewport() {
  const view = editor().viewport
  $('world').style.transform =
    `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
  $('canvas').style.backgroundSize = `${20 * view.zoom}px ${20 * view.zoom}px`
  $('canvas').style.backgroundPosition = `${view.x}px ${view.y}px`
  $('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`
}
function drawEdges() {
  const svg = $('edges'),
    positions = editor().positions
  svg.replaceChildren()
  function path(a, b, className) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.setAttribute('d', wirePath(a, b))
    line.setAttribute('class', className)
    svg.append(line)
    return line
  }
  for (const edge of draft.edges) {
    if (!positions[edge.from] || !positions[edge.to]) continue
    const a = {
      x: positions[edge.from].x + NODE_WIDTH,
      y:
        positions[edge.from].y +
        portY(
          draft.nodes.find((n) => n.id === edge.from),
          edge.branch
        )
    }
    const b = { x: positions[edge.to].x, y: positions[edge.to].y + PORT_Y }
    const id = edgeKey(edge)
    path(a, b, `wire${selectedEdge === id ? ' selected' : ''}`)
    const hit = path(a, b, 'wire-hit')
    hit.setAttribute('role', 'button')
    hit.setAttribute('tabindex', '0')
    hit.setAttribute(
      'aria-label',
      `${edge.from} 到 ${edge.to}，按 Delete 删除连接`
    )
    hit.onclick = (event) => {
      event.stopPropagation()
      selectedEdge = id
      selected = ''
      renderInspector()
      drawEdges()
      $('canvas').focus()
      note('已选择连接。按 Delete 删除，或用撤销恢复。')
    }
    hit.onkeydown = (event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeEdge(id)
      }
    }
  }
  // Tool bindings are not data-flow edges: distinct shape and explicit Core ownership.
  for (const node of draft.nodes)
    for (const tool of node.tools) {
      if (!positions[node.id] || !positions[tool]) continue
      path(
        {
          x: positions[node.id].x + NODE_WIDTH / 2,
          y: positions[node.id].y + NODE_HEIGHT
        },
        { x: positions[tool].x + NODE_WIDTH / 2, y: positions[tool].y },
        'tool-wire'
      )
    }
  if (connection && positions[connection.from]) {
    const a = {
      x: positions[connection.from].x + NODE_WIDTH,
      y:
        positions[connection.from].y +
        portY(
          draft.nodes.find((n) => n.id === connection.from),
          connection.branch
        )
    }
    path(a, connection.point ?? { x: a.x + 70, y: a.y }, 'preview-wire')
  }
}
function startConnection(from, branch) {
  connection = { from, branch }
  drawEdges()
  for (const port of document.querySelectorAll('.port.out'))
    port.classList.toggle(
      'armed',
      port.dataset.owner === from && port.dataset.branch === branch
    )
  note('拖动到目标输入端口，或点击输入端口完成连接。Esc 取消。')
}
function connectNodes(from, to, branch) {
  const error = connectionError(draft, spec, from, to, branch)
  if (error) {
    note(error, true)
    return false
  }
  const merge = draft.nodes.find((n) => n.id === to)?.component === 'flow.merge'
  const replacing =
    !merge &&
    draft.edges.some(
      (edge) => edge.to === to && (edge.from !== from || edge.branch !== branch)
    )
  if (!merge) draft.edges = draft.edges.filter((edge) => edge.to !== to)
  const edge = { from, to, ...(branch ? { branch } : {}) }
  if (!draft.edges.some((e) => edgeKey(e) === edgeKey(edge)))
    draft.edges.push(edge)
  connection = null
  selected = to
  selectedEdge = ''
  changed()
  renderGraph()
  renderInspector()
  note(
    replacing ? '已替换输入连接。每个节点接收一个上游输入。' : '连接已建立。'
  )
  return true
}
function removeEdge(id) {
  draft.edges = draft.edges.filter((edge) => edgeKey(edge) !== id)
  selectedEdge = ''
  changed()
  renderGraph()
  renderInspector()
  note('连接已删除。目标节点将接收本次运行输入。')
}
function renderNodeStates() {
  const same =
    currentRun?.version.agentId === draft.id &&
    !dirty &&
    currentRun.version.revision === revision
  for (const card of $('nodes').children) {
    card.querySelector('.node-state')?.remove()
    delete card.dataset.state
    if (!same) continue
    const id = card.dataset.node,
      done = Object.hasOwn(currentRun.outputs, id)
    const waiting = currentRun.wait?.nodeId === id
    const active = currentOperations.some(
      (operation) => operation.nodeId === id && operation.status === 'started'
    )
    const state = currentRun.skipped?.includes(id)
      ? 'skipped'
      : done
        ? 'completed'
        : waiting
          ? 'waiting'
          : active && currentRun.status === 'running'
            ? 'running'
            : ''
    if (state) {
      card.dataset.state = state
      card.append(
        el(
          'span',
          {
            completed: '已完成',
            skipped: '已跳过',
            waiting: '等待确认',
            running: '运行中'
          }[state],
          'node-state'
        )
      )
    }
  }
  const result = $('selected-node-result')
  if (result) {
    result.textContent = !same
      ? '运行并保存当前版本后，可查看此节点的结果。'
      : currentRun.skipped?.includes(selected)
        ? '此路线未被选中，节点已跳过。'
        : Object.hasOwn(currentRun.outputs, selected)
          ? JSON.stringify(currentRun.outputs[selected], null, 2)
          : currentRun.wait?.nodeId === selected
            ? '正在等待输入或核验。'
            : '此节点尚未完成。'
  }
}
function field(parent, label, input) {
  const wrapper = el('label', label)
  wrapper.append(input)
  parent.append(wrapper)
  return input
}
function jsonField(root, label, value, update, key) {
  const input = field(root, label, el('textarea'))
  input.value = invalidConfigs.get(key) ?? JSON.stringify(value, null, 2)
  input.oninput = () => {
    invalidConfigs.set(key, input.value)
    dirty = true
    updateAdmission()
    try {
      const parsed = JSON.parse(input.value)
      update(parsed)
      invalidConfigs.delete(key)
      input.setCustomValidity('')
      changed()
    } catch {
      input.setCustomValidity('请输入合法 JSON')
    }
  }
  return input
}
function syncConfig(node) {
  if ($('node-config'))
    $('node-config').value = JSON.stringify(node.config, null, 2)
  changed()
  updateNodeSummary(node)
}
function configSelect(root, node, key, label, values) {
  const input = field(root, label, el('select'))
  choices(input, values, node.config[key] ?? values[0][0])
  input.onchange = () => {
    node.config[key] = input.value
    syncConfig(node)
    if (key === 'outputFormat') renderInspector()
  }
}
function renderNodeControls(root, node, s) {
  if (s.kind === 'tool') {
    const mode = field(root, '工具使用方式', el('select'))
    choices(
      mode,
      [
        ['workflow', '流程直接调用'],
        ['bound', '供 Core 自主调用']
      ],
      node.invocation ?? 'bound'
    )
    mode.onchange = () => {
      if (mode.value === 'workflow') {
        node.invocation = 'workflow'
        draft.nodes.forEach((n) => {
          n.tools = n.tools.filter((id) => id !== node.id)
        })
      } else {
        delete node.invocation
        delete node.input
        draft.edges = draft.edges.filter(
          (e) => e.from !== node.id && e.to !== node.id
        )
      }
      changed()
      renderDraft()
    }
  }
  if (node.component === 'model.core') {
    configSelect(root, node, 'outputFormat', '输出格式', [
      ['text', '文本'],
      ['json', 'JSON']
    ])
    if (node.config.outputFormat === 'json')
      jsonField(
        root,
        '输出 Schema / 可在高级配置移除',
        node.config.outputSchema ?? { type: 'object' },
        (v) => {
          node.config.outputSchema = v
          syncConfig(node)
        },
        `${node.id}:schema`
      )
  }
  if (node.component === 'human.wait') {
    const check = field(root, '收集结构化审核表单', el('input'))
    check.type = 'checkbox'
    check.checked = !!node.config.schema
    check.onchange = () => {
      if (check.checked)
        node.config.schema = {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['approve', 'reject'] },
            feedback: { type: 'string' }
          },
          required: ['action'],
          additionalProperties: false
        }
      else delete node.config.schema
      syncConfig(node)
      renderInspector()
    }
    if (node.config.schema)
      jsonField(
        root,
        '审核表单 Schema',
        node.config.schema,
        (v) => {
          node.config.schema = v
          syncConfig(node)
        },
        `${node.id}:schema`
      )
  }
  if (node.component === 'flow.input') {
    jsonField(
      root,
      '输入 Schema',
      node.config.schema,
      (v) => {
        node.config.schema = v
        syncConfig(node)
        renderRunFields()
      },
      `${node.id}:schema`
    )
  }
  if (node.component === 'data.transform') {
    configSelect(root, node, 'mode', '转换操作', [
      ['identity', '保留映射后的值'],
      ['pick', '提取字段'],
      ['parse-json', '解析 JSON 文本']
    ])
    const path = field(root, '字段路径 / 点号分隔', el('input'))
    path.value = (node.config.path ?? []).join('.')
    path.oninput = () => {
      node.config.path = path.value ? path.value.split('.') : []
      syncConfig(node)
    }
  }
  if (node.component === 'http.request') {
    configSelect(
      root,
      node,
      'method',
      '请求方法',
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => [v, v])
    )
    const path = field(root, '服务内路径 / 可含查询参数', el('input'))
    path.value = node.config.path
    path.oninput = () => {
      node.config.path = path.value
      syncConfig(node)
    }
  }
  if (node.component === 'model.decision') {
    configSelect(root, node, 'onError', '决策服务失败时', [
      ['fail', '停止并显示错误'],
      ['fallback', '交给条件节点的默认路线']
    ])
    const entry = Object.entries(node.config.questions ?? {}).find(
      ([, q]) => q.type === 'choice'
    )
    if (entry) {
      const [id, question] = entry
      const text = field(root, `决策问题 / ${id}`, el('textarea'))
      text.value =
        typeof question.instructions === 'string'
          ? question.instructions
          : JSON.stringify(question.instructions)
      text.oninput = () => {
        question.instructions = text.value
        syncConfig(node)
      }
      root.append(el('p', '候选路线与说明', 'muted small'))
      for (const [name, description] of Object.entries(question.criteria)) {
        const row = el('div', undefined, 'candidate-row')
        const input = field(row, name, el('input'))
        input.value =
          typeof description === 'string'
            ? description
            : JSON.stringify(description)
        input.oninput = () => {
          question.criteria[name] = input.value
          syncConfig(node)
        }
        const remove = el('button', '移除')
        remove.onclick = () => {
          delete question.criteria[name]
          syncConfig(node)
          renderInspector()
        }
        row.append(remove)
        root.append(row)
      }
      const name = field(root, '新增候选路线 ID', el('input'))
      name.placeholder = '例如 search'
      const add = el('button', '＋ 候选路线')
      add.onclick = () => {
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name.value) ||
          ['__proto__', 'constructor', 'prototype'].includes(name.value) ||
          Object.hasOwn(question.criteria, name.value)
        )
          return note('请输入未使用的路线 ID', true)
        question.criteria[name.value] = ''
        syncConfig(node)
        renderInspector()
      }
      root.append(add)
    }
    root.append(
      el(
        'p',
        '多问题、Score 与 Noul 可在高级配置中设置。决策结果可通过输入映射引用。',
        'muted small'
      )
    )
  }
  if (node.component === 'flow.branch') {
    for (const branch of node.config.cases ?? []) {
      const group = el('div', undefined, 'condition-group')
      const id = field(group, '出口 ID', el('input'))
      id.value = branch.id
      id.onchange = () => {
        const previous = branch.id
        branch.id = id.value
        draft.edges
          .filter((e) => e.from === node.id && e.branch === previous)
          .forEach((e) => {
            e.branch = id.value
          })
        syncConfig(node)
        renderGraph()
      }
      for (const condition of branch.conditions) {
        const path = field(group, '字段路径 / 点号分隔', el('input'))
        path.value = condition.path.join('.')
        path.oninput = () => {
          condition.path = path.value ? path.value.split('.') : []
          syncConfig(node)
        }
        const op = field(group, '判断', el('select'))
        choices(
          op,
          [
            ['eq', '等于'],
            ['neq', '不等于'],
            ['gte', '大于等于'],
            ['gt', '大于'],
            ['lte', '小于等于'],
            ['lt', '小于'],
            ['contains', '包含'],
            ['exists', '存在'],
            ['missing', '不存在']
          ],
          condition.op
        )
        op.onchange = () => {
          condition.op = op.value
          syncConfig(node)
        }
        const value = field(group, '比较值 / 数字、JSON 或文本', el('input'))
        value.value = JSON.stringify(condition.value ?? null)
        value.oninput = () => {
          try {
            condition.value = JSON.parse(value.value)
          } catch {
            condition.value = value.value
          }
          syncConfig(node)
        }
        const remove = el('button', '移除此条件')
        remove.onclick = () => {
          branch.conditions = branch.conditions.filter((c) => c !== condition)
          syncConfig(node)
          renderInspector()
        }
        group.append(remove)
      }
      const add = el('button', '＋ AND 条件')
      add.onclick = () => {
        branch.conditions.push({ path: [], op: 'eq', value: true })
        syncConfig(node)
        renderInspector()
      }
      const remove = el('button', '移除此出口')
      remove.onclick = () => {
        node.config.cases = node.config.cases.filter((c) => c !== branch)
        draft.edges = draft.edges.filter(
          (e) => e.from !== node.id || e.branch !== branch.id
        )
        syncConfig(node)
        renderGraph()
        renderInspector()
      }
      group.append(add, remove)
      root.append(group)
    }
    const fallback = field(root, '默认出口 ID', el('input'))
    fallback.value = node.config.default
    fallback.onchange = () => {
      const old = node.config.default
      node.config.default = fallback.value
      draft.edges
        .filter((e) => e.from === node.id && e.branch === old)
        .forEach((e) => {
          e.branch = fallback.value
        })
      syncConfig(node)
      renderGraph()
    }
    const add = el('button', '＋ 条件出口')
    add.onclick = () => {
      const ids = branches(node)
      let i = 1
      while (ids.includes(`route_${i}`)) i++
      node.config.cases.push({
        id: `route_${i}`,
        conditions: [{ path: [], op: 'eq', value: true }]
      })
      syncConfig(node)
      renderGraph()
      renderInspector()
    }
    root.append(add)
    root.append(
      el('p', '从上到下匹配；同一出口的条件全部成立才选中。', 'muted small')
    )
  }
  if (node.component === 'flow.merge')
    root.append(
      el(
        'p',
        `已连接 ${draft.edges.filter((e) => e.to === node.id).length} 条路线。仅接收唯一实际执行的结果。`,
        'muted small'
      )
    )
  if (inWorkflow(node, s) && node.component !== 'flow.input') {
    const mode = field(root, '输入值映射', el('select'))
    choices(
      mode,
      [
        ['flow', '使用连接传入的值'],
        ['ref', '引用节点字段'],
        ['json', '组装 JSON 对象']
      ],
      node.input === undefined ? 'flow' : node.input?.$ref ? 'ref' : 'json'
    )
    mode.onchange = () => {
      if (mode.value === 'flow') delete node.input
      else
        node.input =
          mode.value === 'ref'
            ? { $ref: { node: '$input', path: [] } }
            : { task: { $ref: { node: '$input', path: [] } } }
      changed()
      renderInspector()
    }
    if (node.input?.$ref) {
      const source = field(root, '引用来源', el('select'))
      choices(
        source,
        [
          ['$input', '本次运行输入'],
          ...draft.nodes
            .filter((n) => n.id !== node.id && inWorkflow(n, spec(n)))
            .map((n) => [n.id, `${n.id} · ${spec(n).title}`])
        ],
        node.input.$ref.node
      )
      source.onchange = () => {
        node.input.$ref.node = source.value
        changed()
      }
      const path = field(root, '引用字段路径 / 点号分隔', el('input'))
      path.value = (node.input.$ref.path ?? []).join('.')
      path.oninput = () => {
        node.input.$ref.path = path.value ? path.value.split('.') : []
        changed()
      }
    } else if (node.input !== undefined)
      jsonField(
        root,
        'JSON 输入映射 / $ref 保留值类型',
        node.input,
        (v) => {
          node.input = v
          changed()
        },
        `${node.id}:binding`
      )
    root.append(
      el(
        'p',
        '引用的节点必须位于上游。模板也支持 {{nodes.start.task}}。',
        'muted small'
      )
    )
  }
}
function renderRunFields() {
  const root = $('run-fields')
  root.replaceChildren()
  const start = draft.nodes.find((n) => n.component === 'flow.input'),
    schema = start?.config.schema
  $('run-input').hidden =
    !!schema && schema.type === 'object' && !$('run-json').checked
  if ($('run-input').hidden) {
    for (const [name, prop] of Object.entries(schema.properties ?? {})) {
      const input = field(
        root,
        name,
        prop.type === 'boolean' ? el('input') : el('textarea')
      )
      input.dataset.runField = name
      input.dataset.type = prop.type
      if (prop.type === 'boolean') input.type = 'checkbox'
      input.required = (schema.required ?? []).includes(name)
      input.placeholder = ['object', 'array'].includes(prop.type)
        ? 'JSON'
        : `请输入 ${name}`
    }
  }
}
function collectFields(root) {
  const values = {}
  for (const input of root.querySelectorAll('[data-run-field]')) {
    if (!input.reportValidity()) throw new Error('请填写所需参数')
    if (!input.required && !input.value && input.type !== 'checkbox') continue
    values[input.dataset.runField] =
      input.dataset.type === 'boolean'
        ? input.tagName === 'SELECT'
          ? JSON.parse(input.value)
          : input.checked
        : ['number', 'integer', 'object', 'array', 'null'].includes(
              input.dataset.type
            )
          ? JSON.parse(input.value)
          : input.value
  }
  return values
}
function renderWaitFields(node, operationId) {
  const root = $('wait-fields'),
    schema = node?.config.schema
  const form = currentRun?.wait?.reason === 'input' && schema?.type === 'object'
  root.hidden = !form
  $('wait-value').hidden = !!form
  $('wait-json').closest('label').hidden = !!form
  if (waitFormOperation === operationId) return
  waitFormOperation = operationId
  root.replaceChildren()
  if (!form) return
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const input = field(
      root,
      name,
      prop.enum
        ? el('select')
        : prop.type === 'boolean'
          ? el('input')
          : el('textarea')
    )
    input.dataset.runField = name
    input.dataset.type = prop.type
    if (prop.enum)
      choices(
        input,
        prop.enum.map((v) => [String(v), String(v)]),
        '',
        '请选择'
      )
    if (prop.type === 'boolean') input.type = 'checkbox'
    input.required = (schema.required ?? []).includes(name)
  }
}
function runInput() {
  if ($('run-json').checked) return JSON.parse($('run-input').value)
  if (!$('run-input').hidden) return $('run-input').value
  return collectFields($('run-fields'))
}
$('run-json').onchange = renderRunFields
action('add-http', () => {
  draft.resources.push({
    id: nextResourceId('http'),
    type: 'http',
    config: { baseUrl: 'http://127.0.0.1:8080/' }
  })
  changed()
  renderResources()
  renderInspector()
})
action('load-routing', async () => {
  const preset = await api('presets/routing')
  draft = { ...preset, id: blank().id }
  revision = 0
  dirty = true
  selected = 'decision'
  resetHistory()
  editor()
  renderDraft()
  fitCanvas()
  setDrawer('')
  note(
    '已加载语义路由：手动决策夹具仅演示分流。设置中将 router 切换为 JEV 并填写凭证句柄可接真实接口。'
  )
})

function renderInspector() {
  const root = $('inspector')
  root.replaceChildren()
  const node = draft.nodes.find((n) => n.id === selected)
  $('inspector-panel').hidden = !node && !selectedEdge
  if (selectedEdge) {
    root.append(
      el('h2', '数据连接'),
      el('p', selectedEdge.replace(':', ' → '), 'muted')
    )
    const remove = el('button', '删除连接', 'delete')
    remove.onclick = () => removeEdge(selectedEdge)
    root.append(remove)
    return
  }
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
  const meta = el('div', undefined, 'node-meta')
  meta.append(
    el('span', `${s.input} → ${s.output}`),
    el('span', s.effect === 'external' ? '外部操作' : '纯计算')
  )
  root.append(meta)
  const execution = el('details', undefined, 'node-execution')
  execution.append(el('summary', '本次运行输出'))
  const output = el('pre')
  output.id = 'selected-node-result'
  execution.append(output)
  root.append(execution)
  renderNodeStates()
  const commonKey =
    s.id === 'text.template'
      ? 'template'
      : s.id === 'model.core'
        ? 'system'
        : s.id === 'human.wait'
          ? 'prompt'
          : ''
  if (commonKey) {
    const common = field(
      root,
      { template: '提示词模板', system: '系统提示词', prompt: '等待提示' }[
        commonKey
      ],
      el('textarea')
    )
    common.value = node.config[commonKey] ?? ''
    common.dataset.configKey = commonKey
    common.oninput = () => {
      node.config[commonKey] = common.value
      invalidConfigs.delete(node.id)
      changed()
      const jsonEditor = $('node-config')
      jsonEditor.value = JSON.stringify(node.config, null, 2)
      jsonEditor.setCustomValidity('')
      updateNodeSummary(node)
    }
  }
  const advanced = el('details', undefined, 'advanced-config')
  advanced.append(el('summary', '高级配置 / JSON'))
  root.append(advanced)
  const config = field(advanced, '组件配置', el('textarea'))
  config.value =
    invalidConfigs.get(node.id) ?? JSON.stringify(node.config, null, 2)
  if (invalidConfigs.has(node.id))
    config.setCustomValidity('请输入合法 JSON 对象')
  config.id = 'node-config'
  config.oninput = () => {
    invalidConfigs.set(node.id, config.value)
    dirty = true
    $('revision').textContent = '有无效配置 · 未保存'
    updateAdmission()
    renderNodeStates()
    try {
      const value = JSON.parse(config.value)
      if (!value || Array.isArray(value) || typeof value !== 'object')
        throw new Error('配置必须为 JSON 对象')
      node.config = value
      for (const input of root.querySelectorAll('[data-config-key]'))
        input.value = node.config[input.dataset.configKey] ?? ''
      config.setCustomValidity('')
      invalidConfigs.delete(node.id)
      changed()
      updateNodeSummary(node)
    } catch {
      config.setCustomValidity('请输入合法 JSON 对象')
    }
  }
  renderNodeControls(root, node, s)
  if (
    inWorkflow(node, s) &&
    !['flow.input', 'flow.merge'].includes(node.component)
  ) {
    const upstream = field(root, '输入来源', el('select'))
    choices(
      upstream,
      draft.nodes
        .filter(
          (n) =>
            n.id !== node.id &&
            inWorkflow(n, spec(n)) &&
            n.component !== 'flow.branch'
        )
        .map((n) => [n.id, `${n.id} · ${spec(n).title}`]),
      draft.edges.find((e) => e.to === node.id)?.from,
      '本次运行输入'
    )
    upstream.onchange = () => {
      if (upstream.value) {
        if (!connectNodes(upstream.value, node.id))
          upstream.value = draft.edges.find((e) => e.to === node.id)?.from ?? ''
      } else {
        draft.edges = draft.edges.filter((e) => e.to !== node.id)
        changed()
        renderGraph()
      }
    }
  }
  for (const [role, type] of Object.entries(s.resourceRoles)) {
    const select = field(root, `资源绑定 / ${role}`, el('select'))
    choices(
      select,
      draft.resources
        .filter(
          (r) =>
            r.type === type &&
            (type !== 'model' ||
              (s.kind === 'decision') ===
                ['jev', 'decision-compatible', 'decision-fixture'].includes(
                  r.config.provider
                ))
        )
        .map((r) => [r.id, r.id]),
      node.resources[role],
      '请选择资源'
    )
    select.onchange = () => {
      node.resources[role] = select.value
      changed()
      updateNodeSummary(node)
    }
  }
  if (s.kind === 'core') {
    root.append(el('p', 'Core 可调用的工具', 'muted small'))
    for (const tool of draft.nodes.filter(
      (n) => spec(n).kind === 'tool' && n.invocation !== 'workflow'
    )) {
      const check = el('input')
      check.type = 'checkbox'
      check.checked = node.tools.includes(tool.id)
      const label = el('label', undefined, 'tool-check')
      label.append(check, el('span', `${tool.id} · ${spec(tool).title}`))
      root.append(label)
      check.onchange = () => {
        node.tools = check.checked
          ? [...node.tools, tool.id]
          : node.tools.filter((id) => id !== tool.id)
        changed()
        renderGraph()
      }
    }
  }
  const remove = el('button', '移除组件', 'delete')
  remove.onclick = () => {
    delete editor().positions[node.id]
    for (const key of invalidConfigs.keys())
      if (key === node.id || key.startsWith(node.id + ':'))
        invalidConfigs.delete(key)
    draft.nodes = draft.nodes.filter((n) => n.id !== node.id)
    draft.edges = draft.edges.filter(
      (e) => e.from !== node.id && e.to !== node.id
    )
    draft.nodes.forEach((n) => {
      n.tools = n.tools.filter((id) => id !== node.id)
    })
    if (draft.output === node.id)
      draft.output =
        draft.nodes.filter((n) => inWorkflow(n, spec(n))).at(-1)?.id ?? ''
    selected = ''
    changed()
    renderGraph()
    renderInspector()
  }
  root.append(remove)
}
function updateNodeSummary(node) {
  const card = [...$('nodes').children].find(
    (card) => card.dataset.node === node.id
  )
  if (!card) return
  const s = spec(node)
  card.querySelector('.node-summary').textContent =
    s.kind === 'core'
      ? `模型 · ${node.resources.model || '未绑定'} / ${node.tools.length} 个工具`
      : String(
          node.config.template ??
            node.config.prompt ??
            (node.component === 'model.decision'
              ? '决策 · ' + node.resources.model
              : node.component === 'flow.branch'
                ? branches(node).join(' / ')
                : '将上游结果作为输出')
        )
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
          ['openai-compatible', 'OpenAI 兼容接口'],
          ['jev', 'JEV 官方决策接口'],
          ['decision-compatible', '兼容决策接口'],
          ['decision-fixture', '手动决策夹具（非智能模型）']
        ],
        resource.config.provider
      )
      provider.onchange = () => {
        resource.config =
          provider.value === 'demo'
            ? { provider: 'demo' }
            : provider.value === 'decision-fixture'
              ? {
                  provider: provider.value,
                  answers: {
                    route: {
                      type: 'choice',
                      choice: 'fast',
                      confidence: 0.9,
                      probabilities: { fast: 0.95, deep: 0.05 }
                    }
                  }
                }
              : ['jev', 'decision-compatible'].includes(provider.value)
                ? {
                    provider: provider.value,
                    baseUrl: 'https://api.typesafe.ai/v1/systemone',
                    model: 'jev-latest'
                  }
                : {
                    provider: 'openai-compatible',
                    baseUrl: 'http://127.0.0.1:8080/v1',
                    model: 'local-model'
                  }
        changed()
        renderResources()
      }
      if (resource.config.provider === 'decision-fixture') {
        jsonField(
          card,
          '手动答案 / 修改以测试不同路线',
          resource.config.answers,
          (v) => {
            resource.config.answers = v
            changed()
          },
          `resource:${resource.id}`
        )
        card.append(
          el('p', '此提供者不理解任务，仅返回你设定的答案。', 'muted small')
        )
      }
      if (
        ['openai-compatible', 'jev', 'decision-compatible'].includes(
          resource.config.provider
        )
      ) {
        for (const [key, label] of [
          ['baseUrl', '接口地址 / 含 v1'],
          ['model', '模型名'],
          ['credential', '凭证句柄 / 可留空']
        ]) {
          const input = field(card, label, el('input'))
          input.value = resource.config[key] ?? ''
          input.oninput = () => {
            if (input.value || key !== 'credential')
              resource.config[key] = input.value
            else delete resource.config[key]
            changed()
          }
        }
        card.append(
          el('p', '只填写句柄；密钥在本机部署配置中提供。', 'muted small')
        )
      }
    } else if (resource.type === 'http') {
      for (const [key, label] of [
        ['baseUrl', '服务地址'],
        ['credential', '凭证句柄']
      ]) {
        const input = field(card, label, el('input'))
        input.value = resource.config[key] ?? ''
        input.oninput = () => {
          if (input.value) resource.config[key] = input.value
          else delete resource.config[key]
          changed()
        }
      }
    } else
      card.append(
        el(
          'p',
          '工作区由实例创建。同一实例中绑定此资源的组件共享文件。',
          'muted small'
        )
      )
    const remove = el('button', '移除资源')
    remove.onclick = () => {
      invalidConfigs.delete(`resource:${resource.id}`)
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
  $('revision').textContent = revision
    ? `v${revision}${dirty ? ' · 有未保存修改' : ' · 已保存'}`
    : '未保存'
  renderGraph()
  renderInspector()
  renderResources()
  renderInstances()
  renderRunFields()
  updateAdmission()
}
function renderInstances() {
  choices(
    $('instances'),
    instances
      .filter((i) => i.agentId === draft.id)
      .map((i) => [i.id, `实例 ${i.id.slice(0, 8)}`]),
    $('instances').value,
    '选择运行实例'
  )
  if (!$('instances').value && $('instances').options.length > 1)
    $('instances').selectedIndex = 1
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
  if (s.kind === 'tool') node.invocation = 'workflow'
  for (const [role, type] of Object.entries(s.resourceRoles)) {
    let resource = draft.resources.find(
      (r) =>
        r.type === type &&
        (type !== 'model' ||
          (s.kind === 'decision') ===
            ['jev', 'decision-compatible', 'decision-fixture'].includes(
              r.config.provider
            ))
    )
    if (!resource && s.kind === 'decision') {
      resource = {
        id: nextResourceId('model'),
        type: 'model',
        config: {
          provider: 'jev',
          baseUrl: 'https://api.typesafe.ai/v1/systemone',
          model: 'jev-latest'
        }
      }
      draft.resources.push(resource)
    }
    node.resources[role] = resource?.id ?? ''
  }
  if (draft.nodes.length >= 64) throw new Error('首版最多 64 个组件')
  const geometry = editor()
  const placement =
    addPoint ??
    toWorld(
      {
        x: ($('canvas').clientWidth || 1000) / 2,
        y: ($('canvas').clientHeight || 500) / 2
      },
      geometry.viewport
    )
  draft.nodes.push(node)
  geometry.positions[node.id] = {
    x: clamp(
      placement.x - NODE_WIDTH / 2 + (draft.nodes.length % 3) * 24,
      -99000,
      99000
    ),
    y: clamp(
      placement.y - NODE_HEIGHT / 2 + (draft.nodes.length % 3) * 24,
      -99000,
      99000
    )
  }
  addPoint = null
  if (inWorkflow(node, s)) draft.output = node.id
  setDrawer('')
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
  resetHistory()
  renderDraft()
  note('已创建空白装配。')
})
action('load-demo', () => {
  draft = blank()
  draft.name = '最小装配示例'
  selected = ''
  revision = 0
  resetHistory()
  for (const id of [
    'text.template',
    'model.core',
    'human.wait',
    'output.value'
  ])
    addNode(catalog.find((c) => c.id === id))
  draft.edges = draft.nodes
    .slice(1)
    .map((node, index) => ({ from: draft.nodes[index].id, to: node.id }))
  draft.editor.positions = arrangeGraph(draft, spec)
  selected = draft.nodes[1].id
  changed()
  renderDraft()
  fitCanvas()
  note(
    '示例使用离线演示模型，包含一次持久人工等待。可在设置面板的共享资源中切换真实模型接口。'
  )
})
action('save', async () => {
  if (invalidConfigs.size)
    throw new Error('有组件或资源的 JSON 无效，请修正后保存')
  const editor = $('node-config')
  if (editor && !editor.reportValidity()) throw new Error('组件配置 JSON 无效')
  draft.name = $('agent-name').value
  draft.execution = {
    mode: $('mode').value,
    maxActions: Number($('max-actions').value),
    timeoutMs: Number($('timeout').value) * 1000
  }
  draft.output = $('output').value
  const version = await api('definitions', {
    definition: draft,
    expectedRevision: revision
  })
  revision = version.revision
  draft = version.definition
  dirty = false
  resetHistory()
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
  resetHistory()
  renderDraft()
  setDrawer('')
  note(`已打开 ${draft.name} v${revision}。`)
})
action('export', () => {
  const blob = new Blob([JSON.stringify(draft, null, 2)], {
      type: 'application/json'
    }),
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
    imported.nodes.forEach((node) => {
      spec(node)
      if (!node.config || !node.resources || !Array.isArray(node.tools))
        throw new Error('组件定义不完整')
    })
    if (imported.editor) {
      const finite = (v) =>
        typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100000
      const { positions, viewport } = imported.editor
      if (
        !positions ||
        Array.isArray(positions) ||
        !viewport ||
        !finite(viewport.x) ||
        !finite(viewport.y) ||
        !finite(viewport.zoom) ||
        viewport.zoom < 0.25 ||
        viewport.zoom > 1.8 ||
        Object.entries(positions).some(
          ([id, p]) =>
            !imported.nodes.some((n) => n.id === id) ||
            !p ||
            !finite(p.x) ||
            !finite(p.y)
        )
      )
        throw new Error('画布布局无效')
    }
    // Import as a new definition, never overwrite another Agent's history accidentally.
    draft = { ...imported, id: blank().id }
    revision = 0
    dirty = true
    selected = ''
    resetHistory()
    renderDraft()
    setDrawer('')
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
  draft.resources.push({
    id: nextResourceId('workspace'),
    type: 'workspace',
    config: {}
  })
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
  const run = await api('runs', {
    instanceId: $('instances').value,
    input: runInput()
  })
  runId = run.id
  openDock()
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
    const [{ run, operations }, trace] = await Promise.all([
      api(`runs/${runId}`),
      api(`runs/${runId}/trace`)
    ])
    currentRun = run
    currentOperations = operations
    renderNodeStates()
    $('run-context').textContent =
      `${run.version.definition.name} · 固定版本 v${run.version.revision}`
    $('run-status').textContent =
      `${statuses[run.status]} · v${run.version.revision}`
    const pending = operations.find((op) => op.id === run.wait?.operationId)
    $('result').textContent =
      JSON.stringify(
        run.result ??
          (pending
            ? { outputs: run.outputs, pendingOperation: pending }
            : run.outputs),
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
      'operation.failed': '计算失败',
      'node.completed': '节点完成',
      'node.skipped': '路线跳过',
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
      const waitingNode = run.version.definition.nodes.find(
        (n) => n.id === run.wait.nodeId
      )
      renderWaitFields(waitingNode, run.wait.operationId)
      $('wait-help').textContent =
        run.wait.reason === 'unknown'
          ? waitingNode?.component === 'model.decision'
            ? '此决策不会自动重做。请核验结果，以 JSON 提交包含 answers 的决策回执。'
            : '此操作不会自动重做。请先核验实际结果，再提交确认的回执；Core 回执格式为 {"kind":"finish","result":"实际结果"}。'
          : '上游结果显示在下方。此等待会保存，服务重启后仍可继续。'
      $('resolve').textContent =
        run.status === 'paused' ? '提交结果（保持暂停）' : '提交结果并继续'
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
  const value =
    !$('wait-fields').hidden && $('wait-fields').children.length
      ? collectFields($('wait-fields'))
      : $('wait-json').checked
        ? JSON.parse($('wait-value').value)
        : $('wait-value').value
  await api(`runs/${runId}/resolve`, {
    operationId: currentRun.wait.operationId,
    value
  })
  $('wait-value').value = ''
  await observe()
  await refreshHistory()
})
$('run-history').onchange = () => {
  runId = $('run-history').value
  if (!runId) {
    currentRun = undefined
    $('run-status').textContent = '尚未运行'
    $('result').textContent = '选择运行记录查看结果。'
    $('trace').replaceChildren()
    $('wait-box').hidden = true
    for (const id of ['pause', 'resume', 'cancel']) $(id).disabled = true
    renderNodeStates()
  }
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
new ResizeObserver(() => {
  applyViewport()
  drawEdges()
}).observe($('canvas'))
function renderCatalog() {
  $('catalog').replaceChildren()
  const query = $('component-search').value.trim().toLowerCase()
  for (const s of catalog.filter((s) =>
    `${s.title} ${s.description} ${s.id}`.toLowerCase().includes(query)
  )) {
    const button = el('button', undefined, 'catalog-card'),
      title = el('strong')
    title.append(
      el('span', icons[s.kind], 'catalog-icon'),
      el('span', s.title),
      el('span', labels[s.kind], 'kind')
    )
    button.append(title, el('small', s.description))
    button.onclick = () => addNode(s)
    $('catalog').append(button)
  }
  if (!$('catalog').children.length)
    $('catalog').append(el('p', '没有匹配的组件。', 'muted'))
}
function fitCanvas() {
  const left = ['library', 'agents-panel', 'settings-panel'].find(
    (id) => !$(id).hidden
  )
  const inset = left ? $(left).offsetWidth || 258 : 0
  const right = $('inspector-panel').hidden
    ? 0
    : $('inspector-panel').offsetWidth || 302
  editor().viewport = fitViewport(
    editor().positions,
    Math.max(300, ($('canvas').clientWidth || 1300) - inset - right),
    $('canvas').clientHeight || 560
  )
  editor().viewport.x += inset
  applyViewport()
  drawEdges()
}
function historyStep(back) {
  const source = back ? historyPast : historyFuture,
    target = back ? historyFuture : historyPast
  if (!source.length) return
  target.push(JSON.stringify(draft))
  draft = JSON.parse(source.pop())
  lastSnapshot = JSON.stringify(draft)
  invalidConfigs.clear()
  dirty = true
  if (!draft.nodes.some((node) => node.id === selected)) selected = ''
  selectedEdge = ''
  connection = null
  renderDraft()
  updateHistory()
  note(back ? '已撤销。' : '已重做。')
}
for (const [button, panel] of [
  ['show-library', 'library'],
  ['show-agents', 'agents-panel'],
  ['show-settings', 'settings-panel']
])
  action(button, () => setDrawer($(panel).hidden ? panel : ''))
for (const button of document.querySelectorAll('[data-close]'))
  button.onclick = () => setDrawer('')
action('close-inspector', () => selectNode(''))
action('empty-demo', () => $('load-demo').click())
action('open-run', () => openDock())
action('toggle-run', () => openDock($('run-content').hidden))
action('undo', () => historyStep(true))
action('redo', () => historyStep(false))
action('fit', fitCanvas)
action('arrange', () => {
  editor().positions = arrangeGraph(draft, spec)
  changed()
  renderGraph()
  fitCanvas()
})
for (const [id, factor] of [
  ['zoom-in', 1.2],
  ['zoom-out', 1 / 1.2]
])
  action(id, () => {
    editor().viewport = zoomViewport(
      editor().viewport,
      { x: $('canvas').clientWidth / 2, y: $('canvas').clientHeight / 2 },
      factor
    )
    applyViewport()
  })
action('theme', () => {
  const light = document.documentElement.dataset.theme !== 'light'
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
  $('theme').textContent = light ? '深色' : '浅色'
  try {
    localStorage.setItem('lykoi-composer-theme', light ? 'light' : 'dark')
  } catch {}
})
try {
  const savedTheme = localStorage.getItem('lykoi-composer-theme')
  if (savedTheme === 'light') {
    document.documentElement.dataset.theme = 'light'
    $('theme').textContent = '深色'
  }
} catch {}
for (const name of ['result', 'trace'])
  action(`tab-${name}`, () => {
    for (const peer of ['result', 'trace']) {
      $(`tab-${peer}`).setAttribute('aria-selected', String(peer === name))
      $(`${peer}-panel`).hidden = peer !== name
    }
  })
$('component-search').oninput = renderCatalog
$('canvas').addEventListener(
  'wheel',
  (event) => {
    // Focused node widgets retain native scrolling; only the canvas consumes zoom.
    if (event.target.closest('input,textarea,select')) return
    event.preventDefault()
    editor().viewport = zoomViewport(
      editor().viewport,
      point(event),
      Math.exp(-event.deltaY * 0.002)
    )
    applyViewport()
  },
  { passive: false }
)
$('canvas').onpointerdown = (event) => {
  if (gesture || (event.button !== 0 && event.button !== 1)) return
  if (
    !spaceHeld &&
    event.button === 0 &&
    event.target.closest('.node,.wire-hit')
  )
    return
  if (event.target.closest('#empty button')) return
  event.preventDefault()
  $('canvas').focus()
  if (connection) {
    connection = null
    drawEdges()
  }
  gesture = {
    kind: 'pan',
    start: point(event),
    viewport: { ...editor().viewport },
    pointerId: event.pointerId,
    moved: false
  }
  $('canvas').setPointerCapture?.(event.pointerId)
  $('canvas').classList.add('panning')
}
$('canvas').onpointermove = (event) => {
  const p = point(event),
    view = editor().viewport
  if (connection) {
    connection.point = toWorld(p, view)
    drawEdges()
  }
  if (!gesture || gesture.pointerId !== event.pointerId) return
  const dx = p.x - gesture.start.x,
    dy = p.y - gesture.start.y
  gesture.moved ||= Math.abs(dx) + Math.abs(dy) > 3
  if (gesture.kind === 'node') {
    const position = editor().positions[gesture.id]
    position.x = clamp(gesture.position.x + dx / view.zoom, -99000, 99000)
    position.y = clamp(gesture.position.y + dy / view.zoom, -99000, 99000)
    const card = [...$('nodes').children].find(
      (n) => n.dataset.node === gesture.id
    )
    card.style.left = `${position.x}px`
    card.style.top = `${position.y}px`
    drawEdges()
  } else if (gesture.kind === 'pan') {
    view.x = clamp(gesture.viewport.x + dx, -99000, 99000)
    view.y = clamp(gesture.viewport.y + dy, -99000, 99000)
    applyViewport()
  }
}
function finishGesture(event, cancelled = false) {
  if (!gesture || gesture.pointerId !== event.pointerId) return
  const active = gesture
  gesture = null
  if ($('canvas').hasPointerCapture?.(event.pointerId))
    $('canvas').releasePointerCapture(event.pointerId)
  $('canvas').classList.remove('panning')
  if (active.kind === 'node' && active.moved) {
    changed()
    renderNodeStates()
  }
  if (active.kind === 'wire' && active.moved && connection) {
    const target =
      !cancelled &&
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('.port.in')
    if (target)
      connectNodes(connection.from, target.dataset.owner, connection.branch)
    else {
      connection = null
      drawEdges()
      note('未连接到输入端口。')
    }
  }
}
$('canvas').onpointerup = (event) => finishGesture(event)
$('canvas').onpointercancel = (event) => finishGesture(event, true)
$('canvas').onlostpointercapture = (event) => finishGesture(event, true)
$('canvas').ondblclick = (event) => {
  if (event.target.closest('.node')) return
  addPoint = toWorld(point(event), editor().viewport)
  setDrawer('library')
}
document.addEventListener('keydown', (event) => {
  if (event.target.closest?.('input,textarea,select,[contenteditable=true]'))
    return
  if (event.key === ' ') spaceHeld = true
  if (event.key === 'Escape') {
    connection = null
    gesture = null
    $('canvas').classList.remove('panning')
    drawEdges()
    setDrawer('')
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    historyStep(!event.shiftKey)
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdge) {
    event.preventDefault()
    removeEdge(selectedEdge)
  }
})
document.addEventListener('keyup', (event) => {
  if (event.key === ' ') spaceHeld = false
})
window.addEventListener('blur', () => {
  spaceHeld = false
  gesture = null
  connection = null
  $('canvas').classList.remove('panning')
  drawEdges()
})
try {
  catalog = await api('catalog')
  renderCatalog()
  await refreshDefinitions()
  renderDraft()
  lastSnapshot = JSON.stringify(draft)
  await refreshHistory()
} catch (error) {
  note(`无法连接工作台：${error.message}`, true)
}
setInterval(() => {
  if (runId) void observe().catch((error) => note(error.message, true))
}, 1500)
