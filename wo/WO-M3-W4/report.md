# WO-M3-W4 · 完整性门收口 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent；产物一度以**未提交工作区形态**（31 项脏内容）搁置于
  lykoi-cordis，2026-08-30 资产清点作为 🔴R2（"现场未冻结"）发现。Kevin 授权治理侧
  处置（"脏内容你来处理……不必要的就不要"）后，治理侧逐项目视清点：**无一可砍**——
  这批是 W4 完整性门的完整收官成果 + m4_handoff 交接文档，砍任何一块 M4 都得重做。
- 收口 commit：lykoi-cordis `d3e0edb`（基 174942a，45 文件 +4225/-30）；治理侧修复
  commit `c4f21ab`（在前，见复核发现①）。两者已推送 GitHub，🔴R1（九提交未推送单点）
  与 🔴R2 同批关闭。
- 复核：首轮 **750 pass / 4 fail** → 四红全部定位为**遗留时钟炸弹**（失败测试文件
  W4 未触碰；W3 复核 08-25 当天全绿——非 W4 回归）→ 根治后复跑 **754/754 全绿 +
  tsc 净**。复核深度声明：全量测试 + typecheck + 31 项逐项目视 + m4_handoff 全读；
  **未做 W3 级深度抽查**（golden devstate 对账/写集抽测等），收口优先于深审，
  缺口如需补齐应在 M4 切换窗前安排。

## 复核发现①：第二批时钟炸弹（已根治，修法升级）

W3 复核发现①的同型问题第二批，共两处四测：

1. `approval-conversation.test.ts` 静默期三测（含 SK-35、SK-30 四态汇总）：
   `recordDenial(..., { now: T0 })` 用夹具钟记拒绝，而 `requestApproval` 的静默期
   判定点**不收 now**（内部 `recentDenial` 走真实时钟）→ `T0 + DENIAL_QUIET_H(24h)`
   一过，"静默期内应拒"的断言翻红。本次触发即在夹具日 T0=2026-08-25 的 +24h 之后。
2. `outbound.test.ts` SK-80 出站预算：`messengerSend` 用真钟写账（`_reserveProactiveSlot`
   内部 `new Date()`），测试却用 `messengerProactiveRemainingToday(T0)` 夹具钟查账
   ——日桶一换天，写读两口钟对不上账。

- **性质**：同 W3——测试缺陷，非生产缺陷；生产缺省读点用当下时钟是活体语义，正确。
- **修法（升级）**：W3 的修法是把播种钟挪到真钟（`new Date()` 同源）；本次改为
  **补时钟注入口**——`requestApproval` 增 `now?: Date` 透传至 `recentDenial`
  （其签名本就收 now，仅缺透传；形态与 `handleOwnerAnswer.now` 同）；SK-80 改
  **写读同钟**（查询改无参真钟）。三处测试显式传 `now: T0` 后全程单钟。
- **教训（增补入册）**：**修法优先补时钟注入口，而不是把夹具挪到当下**——后者只是
  把炸弹重新上弦（挪到当下的夹具在下一个 TTL 窗口后照炸）。凡断言涉 TTL/过期/冷却/
  静默期/日桶，播种与读取必须同钟；固定 T0 只可用于全程显式传 now 的路径。
- commit：`c4f21ab`（3 文件 +14/-6，考点语义零改动）。

## 复核发现②：产物搁置窗口（治理注记）

W4 产物在唯一一台 Mac 的工作区以未提交形态存在多日：期间任何磁盘故障即**全损且
无任何异地副本**，且治理仓引用的 cordis 提交在 GitHub 上一度不存在（清点 R1）。
纪律增补呈工单模板：**执行波次完成当日必须 commit + push，报告存档不得晚于次日**
——本报告即为补档（执行完成于 08 月下旬，收口存档 2026-08-31）。

## 交付（lykoi-cordis `d3e0edb`）

1. **lykoi-gate 新包**：七检查项 verify + 纯函数 manifest 生成器 + rules schema 孪生
   + CLI（SK-70..76 等价重建）。manifest.sha256 为部署期产物（root 签发，仓内 gitignore）。
2. **GK-6 env 钉面 22 条**统一入册；**GK-13 受保护面重划**（root 属主域按包划；
   `PROTECTED_PATHS` 追加第三条=门源目录，活体两条逐字保全）——W3 TODO④⑤就此闭合。
3. **path-guard**（SK-74 realpath fail closed）+ `isProtectedPath`（SK-73）。
4. **身体图式注册表**（`BodySchemaRegistry`，GK-11/DK-15）：register 返回注销器；
   词汇表外动作/重复注册/漏报副作用一律大声抛；**生产接线归 M5**（器官目录切到
   `registryActionCatalog` 会使器官清单 18→5，属器官上线编排，不顺手做）。
5. restart 线索生产采集器与 deploy 事件（M2 遗留#8，SA-164 缺席即省略）；遥测显式
   分流盖章 `channel:telemetry`（W2 TODO#6 定案，W3 TODO⑦分流入门）；
   testDoubleActionCatalog 改名（W1 TODO#5）；GK-8 投递旋钮走装配面默认关。
6. **dev/prod 双 profile 分明**（M2 遗留#10；`profile/cordis.prod.yml` 新增 171 行）。
7. **docs/m4_handoff.md**：M4 切换交接清单——11 硬前置（GK-9 bootstrap 预授权解
   S1B 死锁、CORE-RETIRE 同窗、R-01 停新起旧严格串行、DA-11 persona TOML sha 取证、
   systemd ExecStartPre 门）+ 3 决断项呈 Kevin（GK-8 通知推送、E3 计税、D-01 超时）
   + 追认批 + 切换窗验收与回滚路径。

## 偏离蓝图

零（治理侧目视范围内）。m4_handoff §E 明确记载感知/执行器官真身
（browser / terminal / research_browser）现为「大声抛」显式替身，真身归 M5
——与 37 章器官编排顺序一致，不构成偏离。
