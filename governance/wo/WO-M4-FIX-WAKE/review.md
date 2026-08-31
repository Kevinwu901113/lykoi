# WO-M4-FIX-WAKE · 复核记录（治理侧）

> 复核：2026-09-01，治理侧（Mac）。执行方 = Opus 子 Agent，单次交卷 EXIT 正常。
> **结论：PASS，零追认项。** 已 ff 合入 main，m4-switch 已重钉（D-FIX-3）。

## 独立复验

- **全量复跑**（复核侧独立执行，非转抄执行方数字）：`npm test` 800 tests /
  789 pass / 0 fail / 11 skipped，`npx tsc --noEmit` 退出码 0 零输出。
  与执行方报告逐数一致。11 条 skip 全部为 `LYKOI_DEVSTATE_DB` 环境闸，
  与本单无关（skip 理由字符串自带说明）。
- **改动面**：`git diff 0db2183..cb2e27e --name-only` = 9 文件，全部落在
  `governance/wo/WO-M4-FIX-WAKE/`、`packages/lykoi-wake/`、
  `profile/cordis.prod.yml` 三处，与工单 forbidden 逐条对过：lykoi-learn 包
  零改动、邻接包零改动、cordis.yml / index*.ts 零改动、package-lock 未动。
- **判据①**：Config/apply/import 面三处实体改动与 converse 逐字同形
  （`loadPersona(resolve(config.personaToml))`）；`parsePersonaData` 在 wake
  已无使用点，import 清理正确；注释定案化完成（全文件无悬案字样）。
- **判据②**：fixtures/persona.toml 16/16 字段对应 TEST_PERSONA（等价钉测试
  在案，两份形状件结构性不许漂）；负例①逐字复现事故报错形态（红态实得
  `$.persona missing required value` = journalctl 原文），负例②钉了
  PersonaConfigError 逐字 message + `ctx.get('wake') === undefined`
  （半个自我不许开机）。红→绿自证方法合规（checkout 基版 src 重跑）。
- **判据③**：prod yml wake 位补 personaToml（与 converse 段同一路径逐字），
  learn 条目退役并留定案注释；`disabled: true` 保持。

## D-FIX-3 执行记录（治理侧）

- main ff 至 `cb2e27e`（= WO 分支尖）。
- **m4-switch 重钉 = `7fed677434f99d61ddf48e818111099eebde0a95`**
  （= main cb2e27e + 六器官位翻开；重造 commit 而非 rebase，翻法逐字复刻
  ebaeda8 原稿，learn 位不再存在）。前一代分支尖 ebaeda8（七位版）作废。
- 引用面更新（`grep -rn ebaeda8` 现仅剩本单 order.md 的事故叙述）：
  - `governance/wo/WO-M4-W2/runbook.md` 树钉点两行 + §2 重钉指引；
  - `governance/wo/WO-M4-W2/paste-1-prepare.sh` 头注两行 + `SWITCH_SHA`；
  - `governance/wo/WO-M4-W2/approval-briefing.md` B8 行（六位 + @7fed677）；
  - `docs/deploy.md` 五处「七个器官位/learn 条目」表述改六位（执行方侦查
    发现 #1 的非钉面部分）。

## 侦查发现的治理处置

1. **文档陈述性错误**：deploy.md 五处本波已修（见上）。
   `docs/m4_handoff.md:51`（「memory/converse/wake/learn 四条」应为三条）在
   `PINNED_DOCS` 哈希钉面内，**本波不动**——按纪律走「出新版本 + root 重签」，
   落地粘贴稿的重签步会顺带覆盖哈希变化，但文件内容修订留给下一次
   m4_handoff 实质修订窗，避免为一个字的计数改动单开重签事由。
2. **prod yml 属 GK-13 root 属主域**：落地粘贴稿步 2 的 `--write-manifest`
   即为此设（止损时点 manifest = 103 文件，落地后条数以输出为准记录）。
3. **getPersona 进程级缓存缺口**（wake 与 converse 都直调 loadPersona，
   同进程同文件读两遍；SA-156「每进程恰一份内核」目前靠文件不变而非缓存）：
   行为无差，**不随本单动**（改它必碰 converse，越 forbidden）。
   记为候选小单 **WO-CACHE-PERSONA**，排队待签。

## 落地路径（她可继续跑，停机窗 = restart 一瞬）

材料：`paste-landing.sh`（本目录）+ bundle（sha256 见稿内）。root 一次粘贴：
前验（persona TOML 在位 / bundle 哈希）→ 取树钉 checkout `7fed677…`（止损
sed 的脏被覆盖，树回到签名对象）→ `--write-manifest` 重签 → restart →
状态/日志读数 → wake 首拍观察（`autonomy_wake`，最长等基线 30 分钟）。

## 落地实录（2026-09-01 01:46，Kevin root 执行 paste-landing.sh）

- 树钉 `7fed677` checkout 干净，止损 sed 痕迹如期覆盖；manifest 重签仍
  103 文件（新增测试文件在签名域外，域=src 面，符合预期）。
- 服务 `active (running)`，gate OK，**十二插件起立 = 基线六件 + 翻位六器官**
  （llm-deepseek / memory / telegram-transport / **wake** / telegram /
  converse 逐名对上 apply 日志）——wake 以 personaToml 配置面首次真启用，
  未炸。production assembly up。
- 粘贴稿自身两处作者错误（执行后发现，树无恙）：六位断言 grep 模式取严格
  子串漏了 heart 位注释的「；R-01」变体（命中 5≠6）；且 `[ … ] && echo`
  在 set -e 下失败**不中止**（AND-OR 豁免），断言静默滑过。已出修正稿
  （模式放宽 + 全部软断言改 if/exit 硬断言）。教训并入 HANDOFF 候选：
  **粘贴稿断言一律显式 if/exit，禁 `[ … ] && echo` 形态**。
- 尾项已收：**wake 首拍到账**（Kevin root 实测 `grep -c autonomy_wake
  audit.jsonl` = 1，心跳基线内）。自主醒拍链路（heart → wake →
  loadPersona(personaToml)）全线实证。**本单彻底关单。**

## 事故账（关账）

- 根因①②均出生规格消灭（personaToml 配置面 + learn 条目退役），各有测试钉。
- 止损（2026-09-01 01:17，Kevin root）：yml 两行 disabled + 重签 103 + 重启，
  `active (running)`，十插件干净起立——顺带实证装配面其余部分健康，风险
  已隔离到 wake 一位。止损标注两行随本落地稿被新树覆盖，无需手工回收。
- 流程教训（入 HANDOFF 候选）：**切换分支翻位前，须核每个被翻条目「翻开即
  可启用」**——占位条目（缺必填配置 / 名字不是插件）在 disabled 态下零测试
  覆盖，唯一暴露点就是生产 loader。后续新增器官位时，翻位 commit 的复核
  清单应含「dev 装配或测试里起过一次该条目」。
