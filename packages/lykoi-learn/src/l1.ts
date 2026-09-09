export const WORKING = 'working'
export const ARCHIVE = 'archive'
export const CLASSES = [WORKING, ARCHIVE] as const
export type ExperienceClass = (typeof CLASSES)[number]

export const WORKING_SOURCES: ReadonlySet<string> = new Set(['conversation', 'environment'])

/** 走"例外通道"的来源:同一来源里既有零信息模板、也有真实返回内容,只能按内容长度分。 */
export const LENGTH_GATED_SOURCES: ReadonlySet<string> = new Set(['action_result'])

export const ACTION_RESULT_MIN_LENGTH = 80

export const RULE_VERSION = 1

export function classifyExperience(source: string, content: string | null | undefined): ExperienceClass {
  if (WORKING_SOURCES.has(source)) return WORKING
  if (LENGTH_GATED_SOURCES.has(source) && [...(content ?? '')].length > ACTION_RESULT_MIN_LENGTH) {
    return WORKING
  }
  return ARCHIVE
}
