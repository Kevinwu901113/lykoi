# WO-U2 复核记录 · 2026-08-17

**结论:PASS(带一项待 owner 裁决)。**`wo/u2` @ `67adbd11`,基 `b0a0e593`(=活体 main),9 commit 一判据一个,EXIT=0 单次通过(14:21→17:19,opus)。

## 独立核对(全部通过)

- **触碰范围**:仅 5 文件——conversation.py(+450/−52)、organs.py(新,185 行)、store.py(+28)、test_u2_mind_entry.py(774 行)、manifest。diff 里测试与 manifest 都在。
- **禁区零触碰**(逐路径 diff 为空):`mind/decide.py`(对照组成立)、`src/lykoi/core/`、`guardian/`(除 manifest)、transport、kernel、s5/s9 两个测试文件(执行方未动,如实上报冲突)。
- **manifest**:107→108 独立重算一致(2 改 1 增,organs.py 落 cognition/ 必须有锚);`approval_rules.json` 那行不可读锚原样保留未改写(沿 WO-U1 先例)。
- **secrets 纪律**:organs.py 全文扫描,唯一命中在 docstring 的纪律说明;无 `os.environ`/`getenv`/env 文件读取;正面扫描用例在测试里。
- **教训 36**:新增 env/state 路径常量 = 零,conftest 无需补,静态守卫不受影响。
- **抽查实跑**:test_u2_mind_entry + gate5 = 52 passed(3:06)复现;s5/s9 失败形态复现且与报告逐字吻合(注入 index 4 > 最后 user index 2)。

## 复核方串行全量(13 块前台分块,无网络重试)

**1899 passed / 5 failed / 6 skipped(计 1904 = 基线 1855 + 本单新增 49,算术闭合)。**
5 条失败逐条归因,**零新增未解释失败**:

| 失败 | 归因 |
|---|---|
| s5::test_injection_is_last_system_message_before_live_user_data | 判据① 口径冲突,待 owner 裁决 |
| s9::test_both_completion_paths_inject_before_live_user | 同上,同一条不变量 |
| test_core_v1_shadow ×2(redaction 键碰撞/秘密参数) | redaction._SECRETS 老基线(教训 38 记录的 2 failed/50 passed) |
| test_p0_integrity::…manifest_matches… | claude 身份 approval_rules 0600 假失败(教训 27) |

## 待 owner 裁决:s5/s9 封存线断言口径

两断言原文均要求 self-state 注入后**紧跟 user 消息**;判据① 重排后对话路径注入后直接是生成点,结构性互斥,非实现瑕疵。**建议改法**(执行方提出,复核方认可):断言改为「注入是最后一条 system,其后不再有任何 system」——语义意图(规范数据紧贴生成点、不被后续指令覆盖)不减反增,对 decide 路径与旧断言等价。补丁在服务器 `/tmp/wo-u2-reviewer-patch.diff`(`git apply --check` 已验证可干净应用)。复核方两次尝试代为应用被 Mac 侧权限分类器拦截("修改红测试"类动作),**遂按其提示上交 owner 裁决**——此类封存线口径变更本也该 owner 过目。

## 合并后附记(2026-08-18 00:19 落地验收)

活体 HEAD `2b8c477f`(merge `166af2b6` + s5/s9 批准补丁);C 步 282 全绿(lykoi 身份,
含 s5/s9 转绿与 p0);重启后 `startup_verify: OK`(ExecStartPre,等效 GATE_OK);
health ok,journal 干净。**两条尾巴(B 步 `&&` 链在 nothing-to-commit 处断裂所致
——统一重签与合并进来的 manifest 逐字节一致,git commit 返回非零)**:
① `.git` 下 17 个 root 属主残留,待 Kevin `chown -R lykoi:lykoi
/home/lykoi/projects/lykoi/.git`(读已验证无碍,写/gc 会撞);
② 五个单元 restart 时报 changed-on-disk 告警(unit 文件 mtime 是老的,疑陈旧标志),
待 Kevin `systemctl daemon-reload` 消警并留意下次重启。
**合并包模板修正(第 9 份起)**:B 步第二命令的 `git commit` 改为
`(git commit -m … || true)`,或把 `chown -R .git` 与 lykoi 门挪到独立命令——
"重签无差异"是正常结局,不该断链。

## 残余风险(如实列)

1. **尾部强调效应未做对话回归**:缓存计划第 3 步原提"8.6 精神的小规模对话回归(时间/念头敏感度会升,验语气不漂)",工单未列此判据,执行方亦未做。缓解:合并后第一天 Kevin 体感 + completion/次 对照(质量粗信号);若语气漂,易变尾部块的措辞可单独调,不必回滚重排。
2. **usage 目标是事后测量**:main 命中率 ≥70% 只能合并 24h 后从 `llm_call` 聚合读出;对照组 autonomous 应稳在 30% 附近。复读命令与基线在 `docs/usage_baseline_2026-08-13.md`。
3. **memory_scopes 写侧缺口**(遗留 F4 既有账):新经验在 L3 实体轴上可能匿名,召回少而不是错;不因本单恶化。
