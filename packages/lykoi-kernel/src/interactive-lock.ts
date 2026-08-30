/**
 * 对话优先标记（shared/interactive_lock.py 对应物；S-17 + 蓝图 W3 交付⑤）。
 *
 * 活体形态是**跨进程**协调：surface（uvicorn，Conversation 住那儿）与 autonomy
 * （独立 unit）不能共享内存，所以用一个 JSON 文件（`active_until` 时间戳）搭桥
 * —— `mark_active` 在一个对话回合到达/结束时写，监督者读 `is_active`，为真就
 * **让位**而不是开一个新的自主回合。**没有硬抢占**：让位是礼让，不是打断。
 *
 * 新体形态（Python→TS 适配，与 GK-4 的 file_lock→单进程同源）：插件树**单进程**
 * ——wake 与 converse 是同一个进程里的两个插件，于是跨进程文件桥退化成一个
 * 模块级的到期时刻。文件面随之消灭，**不是被省略**：跨进程读者不再存在。
 * `LYKOI_INTERACTIVE_WINDOW_S` 的 env 钉面照留（活体同名同义）。
 *
 * 活体的 `singleton_lock`/`release_lock`（flock 单实例闸）**不迁**：那是"只允许
 * 一个 autonomy 进程"的部署期机制，新体单进程插件树里没有第二个实例可挡；
 * 部署期的单实例保证归 systemd/M4 切换清单。
 *
 * **DK-11 语义（本波落法，报告已说明）**：wake 侧 `shouldYieldToChat()` 为真时，
 * 那一拍返回 `yielded` —— 而 `heart.claim()` 已经把积压拍取走了，于是**被让掉的
 * 拍就此丢弃，等下一个基线拍**。活体是 5 秒节律重试（聊天一结束立刻醒），新体
 * 心跳节律更粗，所以让位的代价是"最多晚一个基线拍醒"。刻意不在这里回灌心脏：
 * 回灌会让"她一让位就欠下一拍"，聊得久了积压成串，反而在对话刚结束时炸出一
 * 连串补偿拍 —— 那正是让位想避免的打扰。
 *
 * **GK-13 归属判定（M3-W4 落定，W3 TODO#4）：root 属主域 —— 但理由与
 * proactive-chat.ts 不同，值得写清楚。**
 *
 * 先说反方：本模块**不是**策略件。它不判 allow/ask/deny，改坏它最多让她该让位
 * 时没让位（多打扰 Kevin 一次）或不该让位时让了位（晚醒一拍）。按「改它能不能
 * 改变治理结论」这条判据，它单独拿出来够不上 root 属主域 —— 它更像
 * hash-pin 域的住户。
 *
 * 归 root 属主域的实际理由有两条，都不是它自身的性质：
 *
 *  1. **域按包划，不按文件划。** GK-13 的 root 属主域是「lykoi-kernel 包」，
 *     不是「kernel 里挑出来的那几个文件」。按文件挑域会立刻长出一张需要人工
 *     维护的名单，而名单会过期 —— 新加一个文件忘了登记就掉进无人管的缝里。
 *     补集定义（包在哪个域，文件就在哪个域）没有这条缝。
 *  2. **它住 kernel 是因为调用面，不是因为敏感度。** 让位仲裁要同时被 wake
 *     （自主侧）与 converse（对话侧）够着，而 kernel 是唯一两边都 import 的
 *     那个包（CF-B1；反向 import 一次都不许）。既然住进来了，就跟着包走。
 *
 * 换句话说：**这次是包的域包住了它，不是它自己挣来的域。** 代价只有一个 ——
 * 改这个文件也要 root 重签 manifest。那个代价小到不值得为它开一个按文件划域
 * 的口子。
 */

/** 一次 markActive 覆盖多久（秒）。活体 `LYKOI_INTERACTIVE_WINDOW_S`，缺省 120。 */
export function interactiveWindowS(): number {
  const raw = process.env.LYKOI_INTERACTIVE_WINDOW_S
  if (raw === undefined || raw === '') return 120
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 120
}

/** 进程内的到期时刻（毫秒）；null = 从未标记过。 */
let _activeUntilMs: number | null = null

/**
 * 记下"接下来 windowSeconds 秒内有一场对话在进行"（interactive_lock.mark_active
 * 逐字）。Conversation 在回合**开头与结尾各调一次**（S-17）：开头让正在犹豫的
 * 那一拍让位，结尾把窗口续上，好让紧接着的追问不被一拍自主插进来。
 */
export function markActive(windowSeconds?: number, now?: Date): void {
  const window = windowSeconds === undefined ? interactiveWindowS() : windowSeconds
  _activeUntilMs = (now ?? new Date()).getTime() + window * 1000
}

/**
 * 现在是不是有一场对话在活动窗口内（interactive_lock.is_active 逐字：**缺失/
 * 损坏的标记读作 inactive**——新体等价物 = 从未标记过 → false）。
 */
export function isActive(now?: Date): boolean {
  if (_activeUntilMs === null) return false
  return (now ?? new Date()).getTime() < _activeUntilMs
}

/** 测试用复位（生产无调用方；活体等价物 = 删掉标记文件）。 */
export function _resetInteractiveLockForTest(): void {
  _activeUntilMs = null
}
