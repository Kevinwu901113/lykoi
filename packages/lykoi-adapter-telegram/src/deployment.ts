import { parseTomlSubset } from 'lykoi-decide'

export function parseDeploy(text: string, source = 'deploy.toml'): { telegram_proxy?: string } {
  let data: Record<string, unknown>
  try { data = parseTomlSubset(text) }
  catch { throw new Error(`${source}: invalid TOML`) }
  if (Object.keys(data).length === 0) return {}
  const telegram = data.telegram
  if (Object.keys(data).length !== 1 || typeof telegram !== 'object' || telegram === null || Array.isArray(telegram)) {
    throw new Error(`${source}: expected [telegram] table`)
  }
  const table = telegram as Record<string, unknown>
  if (Object.keys(table).some(key => key !== 'proxy') || typeof table.proxy !== 'string' || !table.proxy) {
    throw new Error(`${source}: expected non-empty [telegram].proxy`)
  }
  try {
    const url = new URL(table.proxy)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error()
  } catch { throw new Error(`${source}: invalid proxy URL`) }
  return { telegram_proxy: table.proxy }
}

