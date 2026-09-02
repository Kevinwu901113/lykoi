# LANDING-F · 零迁移落地记录（2026-09-02 17:38 CST）

WO-PERS-OVERLAY-01（D-PERS-2 relationship overlay）落地：产线树 main@89b04dd →
**main@29ffab1**。零迁移、零 schema 变更（mind_schema 仍 17），但 manifest hash-pin 域
覆盖 `packages/*/src/**.ts`，本单改了 5 个 src 文件，须 root 重签；按 R-01 停 → 备份 →
起串行。Kevin root 亲手执行，一遍全绿，停机约 5 秒（备份 17:37:58 → assembly up
17:38:00）。

## 执行件

- 脚本 `/tmp/landing-f-overlay.sh`，走"会话交全文 + Kevin 落盘 + `sudo bash`"通道
  （E 稿遗留项"先落盘再执行"本次兑现）。治理侧草案 sha256
  `9d699ad5eeabe350b25d5c7ecc8faefd54ce14344cfdbcd1edbd05d8fbd40adb`；窗后 ssh 钉
  服务器上该文件 sha 见"窗后独立核验"。
- 治理账户往服务器 `/tmp` 上传 **bundle 被放行、上传 root 执行脚本被 Mac 分类器拦下**
  ——与"root 执行件走聊天正文"纪律一致，记为通道事实。
- bundle `/tmp/lykoi-landing-f.bundle` sha256
  `2eccef5f912a45a9c6f921d85c461c0b307f51399f2919892924b436289ff0af`
  （`^89b04dd main`，71 对象；两端 sha 一致，verify okay）。

## 顺序（R-01 正序，全部命中）

前验（bundle / persona sha OK、HEAD=89b04dd、schema=17、状态行 17、relationship 行 0）
→ 停（watchdog 最先、备份 timer、service、pgrep 清场）→ root 窗内备份
`/root/backup-pre-overlay-20260902T173758.tar.gz`（10,369,690 字节，sha256 31707035…）
→ 树落地 29ffab1 净 → 内容断言（rw 正本 ×1、shared 副本 ×1、判别式常量 ×1、keyed /
unkeyed 事件各 ×1、scopeInsightSubject ×1、promotedRelationshipInsights ×1、overlay 头部
常量 ×1 + 逐字文本 ×1、conversation 头部引用 ×2、injected ×1、版本常量 17 ×1、无 018
迁移件、prod.yml 无 `disabled: true`、personaToml ×2、var/state canonical）→ 库只读复核
（schema 17、行数 17 不变、integrity ok）→ chown/chmod → manifest 重签 **106** 文件
（与 E 相同：本单新增 0 个 src 文件）+ gate OK → 起新体 + timer 回位 → 记账。

## 回执（root 脚本 §5 / §9）

| 检查 | 值 |
|---|---|
| mind_schema | 17（未动） |
| focus_insight_state 行 | 17（active 15 / shadow 2，窗前后一致） |
| insights category=relationship | 0（预期：第一条要等 L4 得出 relationship_thread 结论 + 3 周期影子期） |
| max focus_cycle | 24 |
| integrity_check | ok |
| NRestarts | 0 |
| 预算 09-02（UTC 日） | 213,882 tokens，续跑 |

## 窗后独立核验（治理侧 ssh，不信自报）

- `.git/HEAD` = 29ffab1b8c0a90d691e7f3c8daa73ee4e30b0aa3。
- `lykoi-cordis.service` active（ActiveEnter 17:38:00），watchdog timer active，备份
  timer active（下一班 09-03 01:30）；NRestarts=0。
- journal 17:37 起 21 行零 error/fail/fatal；含 `gate: OK`、`apply plugin lykoi-wake`、
  `production assembly up; services: audit=ok budget=ok heart=ok llm=ok lykoiLlm=ok`。
- manifest 106 行。
- governance-ops 记账行在（17:38:08，action `landing-f-overlay`）。
- 服务器上执行件 `/tmp/landing-f-overlay.sh` sha256 = 治理草案值 `9d699ad5…40adb`（首次
  窗后钉到执行件 sha）。
- state 库对治理账户不可读（`lykoi:lykoi`，`sqlite3 -readonly` 打不开），库读数以 root
  脚本 §5 / §9 回执为准，未另行核验。

## 意义

- **她有了第二张脸的容器**：从今起 L4 每从 `relationship_thread` 关切得出一条站得住的
  结论，就键到那个人（memory_scopes 实体轴），站住后只在面对那个人时进人格块。今天
  容器是空的，装配逐字节与落地前相同。
- TS 体第一个 memory_scopes 运行期写者上线；契约增补件 017-1。
- 零迁移落地范本第一次实测：与停机迁移窗同形去掉迁移段，约 5 秒。**教训：零迁移 ≠
  零停机**——manifest 钉 src，改 src 就要 root 重签，R-01 就要串行。

## 遗留

- 首月观察点：`"type":"relationship_overlay_keyed"` 精确计数（30 天为 0 → D-1 判别式
  回炉）；`relationship_overlay_unkeyed` 应为 0。
- 与 `wo/fix-loop-01`（另一治理会话在途）合并后需再落一次（同形态，再一次约 5 秒）。
- 旧债不变：迁移后新生关切（id 11-15）无实体轴；本单 owner 兜底覆盖了这条债的
  relationship_thread 部分。
