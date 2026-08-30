#!/usr/bin/env node
/**
 * Lykoi Cordis **生产**启动入口（M4-W2）。
 *
 * 与 dev 入口（./index.ts）的关系：**两个入口，各自只认自己的装配**。
 * dev 入口硬指 ./cordis.yml（还带 M1 smoke 分支），本文件硬指 ./cordis.prod.yml，
 * 二者都不接受任何运行期切换。cordis.prod.yml 头注里「LYKOI_PROFILE=prod」的
 * 旧设想被否决：用 env 选装配 = 在 GK-6 钉面之外再开一个改道旋钮，且 unit 的
 * env 面按前置 #11 只该有凭据。分成两个写死的入口之后，「生产箱上起了 dev
 * 装配」这一失败模式从「可能」变成「不可能」——本文件**零 env 读取**（连
 * LYKOI_M1_SMOKE 都不看）。
 *
 * systemd 接法（前置 #11）：ExecStartPre 挂完整性门（packages/lykoi-gate），
 * 本文件是 ExecStart。门红服务不起；门绿之后这里再验一遍治理地基花名册，
 * 缺位即 exit 1 —— Restart=always 会重试，但失败是大声的，不是半死不活地跑。
 *
 * 本文件在 GK-13 root 属主域（surface.ts 的 PROFILE_ROOT_OWNED_FILES）：
 * 它决定生产箱上装载哪一份装配，和装配面本身同级。
 */
import { Context, Logger } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'

const root = new Context()

// cordis 默认 logger 只进内存 buffer；接 stdout exporter，journald 才看得见。
const stdoutExporter = {
  colors: 0,
  export(message: Parameters<typeof Logger.format>[1]) {
    console.log(Logger.format(stdoutExporter, message))
  },
}
root.logger.exporter(stdoutExporter)

// baseUrl 的置位理由同 dev 入口的坑注：Loader 只写自己的 tree ctx，
// Include 的 ctx 链看不到，所以根上必须直接给。
root.baseUrl = import.meta.url
await root.plugin(Loader, { baseUrl: import.meta.url })
await root.plugin(Include, { path: './cordis.prod.yml', enableLogs: true })
await root.loader.await()

// 治理地基花名册（地板检查）：这五件与器官启用无关，缺一件都不算「起来了」。
// 器官位（memory/converse/wake/telegram…）由装配面的 disabled 位决定，不在此列。
const expectedServices = ['audit', 'budget', 'heart', 'llm', 'lykoiLlm'] as const
const roster = expectedServices.map((n) => `${n}=${root.get(n) ? 'ok' : 'MISSING'}`).join(' ')
console.log(`[lykoi] production assembly up; services: ${roster}`)
if (roster.includes('MISSING')) {
  console.error('[lykoi] FAIL: service roster incomplete')
  process.exit(1)
}
console.log('[lykoi] running (production); systemd owns the lifecycle')
