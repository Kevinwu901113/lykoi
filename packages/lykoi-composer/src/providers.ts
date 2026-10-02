import type { Config, DecisionModel, HttpClient, Json } from './contracts.ts'
import { assertJson, validId } from './definition.ts'
import { object } from './values.ts'

export function validateEndpoint(value: Json | undefined): URL {
  if (typeof value !== 'string') throw new Error('endpoint requires a URL')
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('invalid provider endpoint')
  return url
}
export async function responseJson(response: Response): Promise<Json> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`provider returned HTTP ${response.status}`)
  }
  // Bound streamed bodies too; content-length alone is insufficient.
  const reader = response.body?.getReader()
  if (!reader) throw new Error('provider returned an empty body')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1048576) throw new Error('provider response exceeds 1 MiB')
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assertJson(value)
  return value
}
export function validateQuestions(
  questions: Json
): asserts questions is Config {
  if (
    !object(questions) ||
    !Object.keys(questions).length ||
    Object.keys(questions).length > 32
  )
    throw new Error('expected 1–32 decision questions')
  for (const [id, q] of Object.entries(questions)) {
    if (
      !validId(id) ||
      !object(q) ||
      !['choice', 'score', 'noul'].includes(String(q.type)) ||
      !['string', 'object'].includes(typeof q.instructions) ||
      q.instructions === null ||
      Object.keys(q).some(
        (k) => !['type', 'instructions', 'criteria'].includes(k)
      )
    )
      throw new Error('invalid decision question')
    const description = (v: Json) =>
      v === null || typeof v === 'string' || typeof v === 'object'
    if (
      q.type === 'choice' &&
      object(q.criteria) &&
      Object.values(q.criteria).some((v) => !description(v))
    )
      throw new Error('invalid choice description')
    if (
      q.type === 'score' &&
      Array.isArray(q.criteria) &&
      q.criteria.some((v) => v === null || !description(v))
    )
      throw new Error('invalid score description')
    if (
      q.type === 'choice' &&
      (!object(q.criteria) ||
        Object.keys(q.criteria).length < 2 ||
        Object.keys(q.criteria).length > 255)
    )
      throw new Error('choice requires 2–255 options')
    if (
      q.type === 'score' &&
      (!Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 10)
    )
      throw new Error('score requires 2–10 ordered levels')
    if (
      q.type === 'noul' &&
      q.criteria !== undefined &&
      (!object(q.criteria) ||
        Object.keys(q.criteria).some((k) => !['true', 'false'].includes(k)))
    )
      throw new Error('invalid noul criteria')
  }
}
export function checkDecision(result: Json, questions: Config): void {
  if (!object(result) || !object(result.answers))
    throw new Error('decision provider returned no answers')
  const probability = (v: Json | undefined) =>
    typeof v === 'number' && v >= 0 && v <= 1
  for (const [id, q] of Object.entries(questions)) {
    const question = q as Config,
      answer = result.answers[id]
    if (!object(answer) || answer.type !== question.type)
      throw new Error('decision answer type mismatch')
    if (question.type === 'noul') {
      if (!probability(answer.noul)) throw new Error('invalid noul probability')
      continue
    }
    if (!probability(answer.confidence) || !object(answer.probabilities))
      throw new Error('invalid decision confidence/distribution')
    const expected =
      question.type === 'choice'
        ? Object.keys(question.criteria as Config)
        : (question.criteria as Json[]).map((_, i) => String(i))
    if (
      Object.keys(answer.probabilities).length !== expected.length ||
      expected.some(
        (k) =>
          !Object.hasOwn(answer.probabilities as Config, k) ||
          !probability((answer.probabilities as Config)[k])
      ) ||
      Math.abs(
        Object.values(answer.probabilities).reduce<number>(
          (a, b) => a + Number(b),
          0
        ) - 1
      ) > 0.001
    )
      throw new Error('invalid decision probability distribution')
    if (
      question.type === 'choice' &&
      (typeof answer.choice !== 'string' || !expected.includes(answer.choice))
    )
      throw new Error('decision chose an undeclared option')
    if (
      question.type === 'choice' &&
      (answer.probabilities[answer.choice as string] as number) + 0.000001 <
        Math.max(...Object.values(answer.probabilities).map(Number))
    )
      throw new Error('choice does not match the probability distribution')
    if (
      question.type === 'score' &&
      (typeof answer.score !== 'number' ||
        answer.score < 0 ||
        answer.score > expected.length - 1)
    )
      throw new Error('invalid decision score')
  }
}
export function jevModel(
  config: Config,
  credential?: string,
  fetcher: typeof fetch = fetch
): DecisionModel {
  const endpoint = validateEndpoint(
    config.baseUrl ?? 'https://api.typesafe.ai/v1/systemone'
  ).href
  return {
    async decide(state, questions, signal) {
      validateQuestions(questions)
      if (state === null || !['string', 'object'].includes(typeof state))
        throw new Error('JEV state must be text, object or array')
      const result = await responseJson(
        await fetcher(endpoint, {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(credential ? { authorization: `Bearer ${credential}` } : {})
          },
          body: JSON.stringify({
            model: config.model ?? 'jev-latest',
            state,
            questions
          })
        })
      )
      checkDecision(result, questions)
      return result
    }
  }
}
/** Manual fixtures only. Never interprets text or claims to emulate JEV intelligence. */
export function fixtureDecisionModel(config: Config): DecisionModel {
  return {
    async decide(_state, questions) {
      const result: Json = {
        model: 'manual-fixture',
        answers: config.answers as Json
      }
      checkDecision(result, questions)
      return structuredClone(result)
    }
  }
}
export function httpClient(
  config: Config,
  credential?: string,
  fetcher: typeof fetch = fetch
): HttpClient {
  const base = validateEndpoint(config.baseUrl),
    prefix = base.pathname.replace(/\/$/, '') + '/'
  return {
    async request(path, method, body, signal) {
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(path) ||
        path.startsWith('//') ||
        path.includes('\\') ||
        path.includes('#')
      )
        throw new Error('HTTP path must stay inside its bound resource')
      const pathname = path.split('?')[0]
      if (/%2f|%5c|%25/i.test(pathname))
        throw new Error('HTTP path contains encoded resource separators')
      const url = new URL(path.replace(/^\//, ''), `${base.origin}${prefix}`)
      if (url.origin !== base.origin || !url.pathname.startsWith(prefix))
        throw new Error('HTTP path escapes resource prefix')
      const result = await responseJson(
        await fetcher(url, {
          method,
          signal,
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(credential ? { authorization: `Bearer ${credential}` } : {})
          },
          ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
        })
      )
      return result
    }
  }
}
