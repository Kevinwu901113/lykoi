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

/** `question` 缺席时的缺省提示词（llm_router.py:246-248 逐字）。 */
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
