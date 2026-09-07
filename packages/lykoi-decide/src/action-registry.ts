/** Shared cognitive action vocabulary. This table describes names and shapes;
 * approval decisions and wired handlers remain kernel runtime facts.
 */
export interface ToolSpec {
  /** kernel 动作类型；三个 in-cognition 工具不过 dispatch，记 `null`。 */
  action: string | null
  /** 形参列表，**不含工具名本身** —— 渲染时拼成 `name(signature)`。 */
  signature: string
  /** 什么时候用它、它与别的出口的分工。 */
  purpose: string
}

/**
 * 工具名不能带点，所以在这里映到 kernel 的动作类型上；signature 一律以动作层
 * handler **实际读取的参数名**为准（依据逐条见 WO-FIX-TOOLSPEC-01 报告）。
 *
 * 五个动作至今只有 `unwiredResources()` 的替身（`browser.click/type/screenshot`、
 * `research_browser.open/extract_links`）：其中 research 两项按 browser 器官
 * handler 的 `needsUrl` 惯例写 `url`，另外三项没有任何真身可核，signature 记
 * `...` —— 宁可说"形状未定"，也不编一个她会照着填的假参数。生产口径下
 * `wiredActions` 会把这五行整个滤掉，她看不到它们。
 */
export const TOOL_TABLE: Readonly<Record<string, ToolSpec>> = {
  terminal_exec: {
    action: 'terminal.exec',
    signature: 'command',
    purpose: '在你自己的虚拟电脑上跑一条 shell 命令；这是真动手的事，执行前会先问 {owner}',
  },
  browser_navigate: {
    action: 'browser.navigate',
    signature: 'url',
    purpose: '常驻桌面浏览器打开一个网址：真实浏览器、带登录态，防爬验证拦下 research 时换它',
  },
  browser_screenshot: {
    action: 'browser.screenshot',
    signature: '...',
    purpose: '未接线（真身未到）：常驻浏览器截屏；参数形状随真身确定',
  },
  browser_get_text: {
    action: 'browser.get_text',
    signature: 'max_chars?',
    purpose: '读常驻浏览器此刻停在那一页的正文；它不收 url，先 browser_navigate 再读',
  },
  browser_click: {
    action: 'browser.click',
    signature: '...',
    purpose: '未接线（真身未到）：常驻浏览器里点一下；参数形状随真身确定',
  },
  browser_type: {
    action: 'browser.type',
    signature: '...',
    purpose: '未接线（真身未到）：常驻浏览器里输入文字；输入是密码、付款的必经之路，接线后会问 {owner}',
  },
  research_open: {
    action: 'research_browser.open',
    signature: 'url',
    purpose: '未接线（真身未到）：一次性只读浏览器打开一个网址',
  },
  research_read_text: {
    action: 'research_browser.read_text',
    signature: 'url, max_chars?',
    purpose: '一次性只读浏览器读一个网址的正文：查资料、搜索、读网页优先用它'
      + '——免审批、即开即用、没有登录态、读完即焚。它只收 url，没有检索词参数',
  },
  research_extract_links: {
    action: 'research_browser.extract_links',
    signature: 'url',
    purpose: '未接线（真身未到）：一次性只读浏览器取一页上的链接',
  },
  notify_owner: {
    action: 'notify.owner',
    signature: 'content',
    purpose: '对话之外主动找 {owner}：问验证码、联系方式这类只有{owner}能给的信息，'
      + '或把后台跟进的结果送到他那里。正在对话里就直接 reply，不要用它送答案',
  },
  // 三个 in-cognition 工具（S-54）：不过 dispatch，所以 action 为 null，也就不
  // 进 TOOL_TO_ACTION 投影；参数形状与其余工具同表同形，她读到的是同一张表。
  vision_describe: {
    action: null,
    signature: 'attachment_id, question?',
    purpose: '把上下文里的截图交给视觉模型"看懂"；attachment_id 只能用上下文里出现过的那个',
  },
  promise_followup: {
    action: null,
    signature: 'task',
    purpose: '这一轮做不完：登记后台跟进（task 写清要完成什么、卡在哪里）；'
      + '回复结束后你会在后台继续做，做完的结果以你的名义发进对话',
  },
  post_progress: {
    action: null,
    signature: 'content',
    purpose: '后台跟进途中给 {owner} 发一条进展；只在后台回合可用，现场对话直接在回复里说',
  },
}


/** Ordered autonomous vocabulary. Internal actions retain their distinct effects. */
export const AUTONOMY_ACTIONS = {
  explore: { action: TOOL_TABLE.research_read_text!.action!, contentRequired: false },
  record_note: { action: null, contentRequired: true },
  queue_notification: { action: 'autonomy.queue_notification', contentRequired: true },
  initiate_chat: { action: 'autonomy.initiate_chat', contentRequired: true },
  tend_inner: { action: null, contentRequired: true },
  rest: { action: null, contentRequired: false },
  contemplate: { action: null, contentRequired: false },
} as const
export type AutonomyKindName = keyof typeof AUTONOMY_ACTIONS
