// Editor geometry and connection admission. Runtime validation remains authoritative.
export const NODE_WIDTH = 232
export const NODE_HEIGHT = 166
export const PORT_Y = 88
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function connectionError(graph, getSpec, from, to) {
  const a = graph.nodes.find((n) => n.id === from)
  const b = graph.nodes.find((n) => n.id === to)
  if (!a || !b) return '连接的组件不存在'
  if (from === to) return '不能连接组件自身'
  const source = getSpec(a),
    target = getSpec(b)
  if (source.kind === 'tool' || target.kind === 'tool')
    return '工具通过 Core 的工具绑定使用，不接入数据流'
  if (source.output === 'any' && target.input === 'text')
    return '类型不兼容：此输入需要文本，上游可能输出任意 JSON'
  const pending = [to],
    seen = new Set()
  while (pending.length) {
    const id = pending.pop()
    if (id === from) return '此连接会形成环路'
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of graph.edges) if (edge.from === id) pending.push(edge.to)
  }
  return ''
}

export function arrangeGraph(graph, getSpec) {
  const positions = {},
    levels = new Map(),
    visiting = new Set(),
    rows = new Map()
  function level(id) {
    if (levels.has(id)) return levels.get(id)
    if (visiting.has(id)) return 0 // Imported invalid drafts are still inspectable.
    visiting.add(id)
    const parents = graph.edges.filter((e) => e.to === id).map((e) => e.from)
    const value = parents.length
      ? Math.min(63, 1 + Math.max(...parents.map(level)))
      : 0
    visiting.delete(id)
    levels.set(id, value)
    return value
  }
  let toolRow = 0
  for (const node of graph.nodes) {
    if (getSpec(node).kind === 'tool') {
      positions[node.id] = { x: 40 + toolRow++ * 284, y: 310 }
      continue
    }
    const column = level(node.id),
      row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    positions[node.id] = { x: 40 + column * 284, y: 70 + row * 220 }
  }
  return positions
}

export function toWorld(point, viewport) {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom
  }
}
export function zoomViewport(viewport, point, factor) {
  const world = toWorld(point, viewport),
    zoom = clamp(viewport.zoom * factor, 0.25, 1.8)
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom }
}
export function fitViewport(positions, width, height) {
  const values = Object.values(positions)
  if (!values.length || !width || !height) return { x: 0, y: 0, zoom: 1 }
  const left = Math.min(...values.map((p) => p.x)),
    top = Math.min(...values.map((p) => p.y))
  const right = Math.max(...values.map((p) => p.x)) + NODE_WIDTH
  const bottom = Math.max(...values.map((p) => p.y)) + NODE_HEIGHT
  const zoom = clamp(
    Math.min((width - 80) / (right - left), (height - 100) / (bottom - top)),
    0.25,
    1
  )
  return {
    x: (width - (right - left) * zoom) / 2 - left * zoom,
    y: (height - (bottom - top) * zoom) / 2 - top * zoom,
    zoom
  }
}
export function wirePath(a, b) {
  const bend = Math.max(55, Math.abs(b.x - a.x) * 0.45)
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`
}
