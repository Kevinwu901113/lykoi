#!/usr/bin/env node
/**
 * 完整性门 CLI（活体 `startup_verify.py` 的 `main()` 对应物；SK-70）。
 *
 *     node packages/lykoi-gate/src/cli.ts                  # 校验；任一问题 exit 1
 *     sudo node packages/lykoi-gate/src/cli.ts --write-manifest   # root 重签入口
 *
 * 生产接法：systemd unit 的 `ExecStartPre=`（两个 unit 都挂），**在 `npm start`
 * 之前**跑。exit 1 = 服务不起来 —— 这是 fail closed 的物理面：治理周界看着像被
 * 动过，就不启动。
 */
import { chmodSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeManifest, manifestPath, protectedEntries, renderManifest, sha256File } from './manifest.ts'
import { productionEnv, verify } from './verify.ts'

/** 仓库根 = 本文件往上四层（packages/lykoi-gate/src/cli.ts → repo）。 */
export function repoRootFromHere(moduleUrl: string): string {
  return join(dirname(fileURLToPath(moduleUrl)), '..', '..', '..')
}

export function main(argv: readonly string[], repoRoot: string): number {
  if (argv.includes('--write-manifest')) {
    const env = productionEnv(repoRoot)
    const entries = protectedEntries(repoRoot, {
      personaToml: env.personaToml,
    })
    const missing = entries.filter((e) => {
      try { sha256File(e.path); return false } catch { return true }
    })
    if (missing.length > 0) {
      for (const entry of missing) {
        console.error(`gate: cannot sign (missing): ${entry.name}`)
      }
      return 1
    }
    const lines = computeManifest(entries, sha256File)
    const path = manifestPath(repoRoot)
    writeFileSync(path, renderManifest(lines), 'utf8')
    try {
      chmodSync(path, 0o444) // 活体 guardian 文件 444 的同一姿态
    } catch {
      // 非 root 跑（dev 重签）时改不动属主/权限：不是签名本身的失败，照常出清单。
    }
    console.log(`gate: wrote manifest for ${lines.length} files -> ${path}`)
    return 0
  }

  const problems = verify(productionEnv(repoRoot))
  if (problems.length > 0) {
    for (const problem of problems) console.error(`gate: FAIL: ${problem}`)
    return 1
  }
  console.log('gate: OK')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), repoRootFromHere(import.meta.url)))
}
