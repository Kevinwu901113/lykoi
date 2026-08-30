/**
 * vision seam（cognition/llm_router.describe_image:239-259 逐字对拍；M3-W3 ⑦）。
 *
 * 把一张 `browser.screenshot` 变成她（主模型）能推理的文字 —— 这是她"看见"屏幕的
 * 方式。本模块只造**调用形状**：读文件 → base64 → 一条带 image_url 的 user 消息 →
 * VISION 路由。真模型那一跳是注入的 `completion`（本波零真网：测试注 fake，生产
 * 接线随 M4 的路由配置）。
 *
 * 分层保持 S-56 不变：**只有可信生产者发出的 attachment id 才 resolve** ——
 * 猜的 id、裸路径永远到不了 `open()`/网络。那一层闸在 Conversation 里，本模块拿到
 * 的已经是一个解析过的路径。
 */
import { readFileSync } from 'node:fs'

// --- M4 定案：vision 路由位显式 disabled ---------------------------------------

/**
 * 「决定不开」的**显式值**。M4 蓝图定案：deepseek-chat 无视觉面，切换窗不开新
 * 回路，所以 `visionRoute: disabled` 是一个填进装配面的**决定**，不是一个空位。
 *
 * 「忘了填」（空串）与「决定不开」（本常量）必须分得开：两者都零真模型调用，
 * 但前者是一次疏漏、后者是一次治理决定 —— 事件流上分成两条，运维看得出差别。
 */
export const VISION_DISABLED = 'disabled'

/** 装配面 vision 位的三态。 */
export type VisionSeamState = 'disabled' | 'unconfigured' | 'wired'

/** 装配期落一条：vision 位是什么状态（`disabled` 与 `unconfigured` 各一条）。 */
export const VISION_SEAM_EVENT = 'vision_seam_state'

/**
 * 读装配面的 vision 位。**只认显式值**：
 *
 *  - `'disabled'`  → 决定不开（M4 定案）
 *  - `''`/空白     → 没填（疏漏；与 disabled 同样零真模型调用，失败方向一致）
 *  - 其余          → 已接线（route/model 走那一对）
 */
export function visionSeamState(route: string | undefined, model: string | undefined): VisionSeamState {
  const trimmed = (route ?? '').trim()
  if (trimmed === VISION_DISABLED) return 'disabled'
  if (trimmed === '' || (model ?? '').trim() === '') return 'unconfigured'
  return 'wired'
}

/**
 * vision 位不是「已接线」时，describeImage 的显式替身：**大声抛，绝不静默成功**
 * （M3 起的同一条纪律）。抛出的这一条由 Conversation 的 `vision_error` 分支接住
 * —— 她会知道自己这次没看见，而不是收到一句凭空的描述。
 */
export class VisionDisabledError extends Error {
  readonly state: VisionSeamState

  constructor(state: VisionSeamState) {
    super(state === 'disabled'
      // 措辞把两态分开：一个是决定，一个是疏漏。
      ? 'vision 路由在装配面显式 disabled（M4 定案：不接真模型）'
      : 'vision 路由未配置（visionRoute/visionModel 为空 —— 装配面漏填，非 disabled）')
    this.name = 'VisionDisabledError'
    this.state = state
  }
}

/** `question` 缺席时的缺省提示词（llm_router.py:246-248 逐字）。 */
// （类型 `VisionCompletion` 定义在下方；守卫工厂紧随其后。）
export const VISION_DEFAULT_PROMPT
  = '请详细描述这张截图里的内容：页面标题、主要文字、以及可点击/可输入的元素。'

export interface VisionContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface VisionMessage {
  role: 'user'
  content: VisionContentPart[]
}

export type VisionCompletion = (
  messages: VisionMessage[],
) => Promise<{ content?: string | null } | null>

/**
 * 按装配面的 vision 位给真调用装一道**前置**守卫（M4 定案的落点）。
 *
 * 「零真模型调用」这句话要靠结构成立而不是靠注释：判定在 `call` **之前**，
 * 所以 `state !== 'wired'` 时那一跳根本不发生 —— 不是发出去再丢掉响应，也不是
 * 靠一个恰好没配路由的 provider 报错。
 */
export function createVisionCompletion(deps: {
  state: VisionSeamState
  call: VisionCompletion
}): VisionCompletion {
  return async (messages) => {
    if (deps.state !== 'wired') throw new VisionDisabledError(deps.state)
    return await deps.call(messages)
  }
}

/** `.jpg`/`.jpeg` → image/jpeg，其余一律 image/png（conversation.py:1678 逐字）。 */
export function visionMediaType(path: string): string {
  const lower = path.toLowerCase()
  return (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg' : 'image/png'
}

/**
 * 那一条消息（llm_router.py:249-257 逐字）：单条 user，content 两段 —— 先文字
 * 提示，后 `data:<media>;base64,<b64>` 的 image_url。
 */
export function buildVisionMessages(
  imageB64: string,
  question: string | null,
  mediaType = 'image/png',
): VisionMessage[] {
  const prompt = question || VISION_DEFAULT_PROMPT
  return [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } },
    ],
  }]
}

/**
 * 装配 `ConverseDeps.describeImage`。抛出的一切由 Conversation 那一侧的
 * `vision_error` 分支接住（它已经把网络边界当网络边界处理），所以这里**不吞**：
 * 读不了的图与调不通的模型都必须让上面看见，而不是变成一句空描述。
 */
export function createDescribeImage(deps: { completion: VisionCompletion }) {
  return async function describeImage(path: string, question: string | null): Promise<string> {
    const raw = readFileSync(path) // OSError → 上面的 vision_error 分支
    const messages = buildVisionMessages(
      raw.toString('base64'), question, visionMediaType(path),
    )
    const message = await deps.completion(messages)
    return (message?.content ?? '') || ''
  }
}
