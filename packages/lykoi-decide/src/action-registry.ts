/** Ordered autonomous vocabulary. Internal actions retain their distinct effects. */
export const AUTONOMY_ACTIONS = {
  explore: { action: 'research_browser.read_text', contentRequired: false },
  record_note: { action: null, contentRequired: true },
  queue_notification: { action: 'autonomy.queue_notification', contentRequired: true },
  initiate_chat: { action: 'autonomy.initiate_chat', contentRequired: true },
  tend_inner: { action: null, contentRequired: true },
  rest: { action: null, contentRequired: false },
  contemplate: { action: null, contentRequired: false },
} as const
export type AutonomyKindName = keyof typeof AUTONOMY_ACTIONS
