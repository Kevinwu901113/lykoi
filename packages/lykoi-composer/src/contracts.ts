export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json }
export type Config = Record<string, Json>
export interface NodeDefinition {
  id: string
  component: string
  version: string
  config: Config
  resources: Record<string, string>
  tools: string[]
  // Explicit JSON binding; {$ref:{node:"$input"|id,path:string[]}} preserves value types.
  input?: Json
  invocation?: 'workflow'
}
export interface AgentDefinition {
  id: string
  name: string
  nodes: NodeDefinition[]
  // Control-flow edges; branch is required for conditional exits.
  edges: { from: string; to: string; branch?: string }[]
  output: string
  resources: { id: string; type: ResourceType; config: Config }[]
  execution: { mode: 'single' | 'tools'; maxActions: number; timeoutMs: number }
  // Presentation only. The executor never uses editor geometry to determine order.
  editor?: {
    positions: Record<string, { x: number; y: number }>
    viewport: { x: number; y: number; zoom: number }
  }
}
export interface DefinitionVersion {
  agentId: string
  revision: number
  hash: string
  definition: AgentDefinition
  createdAt: string
}
export interface Instance {
  id: string
  agentId: string
  createdAt: string
}
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Json[]
}
export type CoreDecision =
  | { kind: 'finish'; result: Json }
  | { kind: 'act'; action: { tool: string; input: Json; callId: string } }
export interface Model {
  compute(
    messages: Message[],
    tools: { name: string; description: string; parameters: Config }[],
    signal: AbortSignal,
    options?: { json: boolean }
  ): Promise<CoreDecision>
}
export type ResourceType = 'model' | 'workspace' | 'http'
export interface DecisionModel {
  decide(state: Json, questions: Config, signal: AbortSignal): Promise<Json>
}
export interface HttpClient {
  request(
    path: string,
    method: string,
    body: Json,
    signal: AbortSignal
  ): Promise<Json>
}
export type ResourceValue =
  Model | DecisionModel | HttpClient | { root: string }
export interface InvocationContext {
  instanceId: string
  runId: string
  operationId: string
  signal: AbortSignal
  render?(template: string, input: Json): string
  resource(role: string): ResourceValue
}
export type ComponentResult =
  { status: 'completed'; value: Json } | { status: 'waiting'; prompt: string }
export interface Component {
  id: string
  version: string
  title: string
  description: string
  kind: 'transform' | 'core' | 'decision' | 'tool' | 'wait' | 'control'
  effect: 'pure' | 'external'
  input: 'text' | 'any'
  output: 'text' | 'any'
  defaultConfig: Config
  resourceRoles: Record<string, ResourceType>
  toolSchema?: Config
  validate(config: Config): void
  invoke?(
    input: Json,
    config: Config,
    context: InvocationContext
  ): Promise<ComponentResult>
}
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export interface Run {
  id: string
  instanceId: string
  version: DefinitionVersion
  input: Json
  status: RunStatus
  outputs: Record<string, Json>
  skipped?: string[]
  result?: Json
  error?: string
  wait?: {
    operationId: string
    nodeId: string
    reason: 'input' | 'unknown'
    prompt: string
  }
  createdAt: string
  updatedAt: string
  activeMs?: number
}
export interface Operation {
  id: string
  runId: string
  nodeId: string
  component: string
  version: string
  input: Json
  status: 'started' | 'completed' | 'waiting' | 'unknown' | 'failed'
  result?: Json
  prompt?: string
}
export interface Trace {
  sequence: number
  runId: string
  type: string
  at: string
  data: Config
}
