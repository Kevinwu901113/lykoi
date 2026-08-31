# WO-BASE-01 五项"待核实"核查记录 · 2026-08-13(治理侧只读核查)

出处:`WO-BASE-01/review.md` §修正注记 3 —— 五项于 2026-08-09 被"转入后续工单
范围",此后无任何工单认领。本次按"不新开工单、把没做完的补上"的口径,由治理侧
直接只读核完,产出的修复走复核者补丁(合并包 10)。

| # | 项 | 结论 | 处置 |
|---|---|---|---|
| 1 | `mind/regulation.py` 与"后天关切"的映射 | 模块自洽;但映射是**单向一条边**(`concern_lit_unfollowed` → exploration_hunger +0.05,`reflow.py:257-259` 触发),反向零条边——`cognitive_effects()` 的 8 个键都不改关切权重/状态,关切权重只由 `store.light_concern` 与确定性变暗规则驱动。报告"映射细节未验证"的疑虑可销 | 无需改代码;**发现 `integrator.py` 注释把阈值写成 0.7(实际 0.9)** → 已改 |
| 2 | 策略 JSON 的 schema 与运行时验证 | **全仓最扎实的一处,零 fail-open**:路径写死不可用环境变量改(`/var/lib/lykoi-attention-policy`、`/var/lib/lykoi-permission-replay-policy`);文件层查绝对路径/固定 root 直接子节点/uid=gid=0/root 非组他人可写/文件恰好 0444/`st_nlink==1`/非符号链接/≤64KB,`O_NOFOLLOW|O_CLOEXEC` 打开后 `fstat` 比对 `(st_dev, st_ino)` 防 TOCTOU;内容层 sha256 精确匹配 + 严格 UTF-8 + 拒重复键 + 拒浮点/NaN/Inf + 顶层键集合精确相等 + canonical-json 重编码校验。失败一律抛,**无内置兜底策略**(docstring 明写);策略自身 default 是 `decline` | 销账,无需动作 |
| 3 | `cognition/attachments.py` 的"inline tested" | 标注不实但**不在源码里**(它在 BASE-01 报告的清单栏):模块 33 行无 doctest,`pytest.ini` 也没开 `--doctest-modules`,`tests/` 无 `test_attachments.py`。真实覆盖来自 `tests/test_governance_invariants.py:144-168`(治理不变量 #6),覆盖 `register()`、`resolve()` 命中/未命中三条;**未覆盖** `attachments.py:30-31` 的非字符串 `attachment_id` 分支。另注:`_REGISTRY` 只增不删,进程内每次 `browser.screenshot` 留一条(极小的常驻增长) | 记录在案;不新开单 |
| 4 | `resources/research_browser.py` 的入口分析 | 四个 dispatch 入口(open / read_text / extract_links / screenshot)**无一绕过 guard**:全部经 `_run()`,打三道(启动前、重定向落地、每跳 CDP 拦截 + MAX_REDIRECTS=5);`_launch`/`_page_ws_url`/`_Conn` 不在 `KNOWN_ACTIONS`,`_resolve` 取不到。**但 docstring 承诺的"截图路径由 cognition 注册成不透明 attachment"没有对应代码**(`conversation.py` 的 `_result_payload` 只覆盖 `browser.screenshot`);今天不可达(`TOOL_TO_ACTION` 无此工具),但该动作在 autonomous 白名单里直接 allow,**接上调用方就会把真实路径喂给模型** | docstring 改成事实并写明"接调用方那张单必须同时补 attachment 注册" → 已改。证据不足项:生产 `always_allow` 的实际内容(`approval_rules.json` 0600 读不到)、`LYKOI_RESEARCH_PROXY` 是否设置(secrets 读不到) |
| 5 | M3 各 R* 标记的生产默认值 | 默认来源全是环境变量,**代码默认一律禁用**,"什么都不配置" = 全关;生产的启用来自 root-owned drop-in(core 有 R1a/R1b/R1c/R2b/R2c-R1,server/autonomy 有 R0 等)。**`LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED` 与 `LYKOI_CORE_SCHEMA_V2_ACTIVATION` 任何 drop-in 都没设** —— 即 R3 replay 在生产是关的,尽管封存策略 `r3_terminal_hard_ask_sentinel_v1.json` 早在 8-02 就部署到位。**真缺陷:`core/shadow.py` 的 `enabled()` 是全组唯一黑名单判定,空串/笔误 fail-open** | `enabled()` 已改为与同组一致的严格判定(absent/`0` → 关,恰好 `1` → 开,其余抛);"策略已就位、开关从未打开"进台账(见下) |

## 进台账的运维事实(非缺陷,但此前无人记录)

- **R3 permission replay:策略已封存部署(2026-08-02),开关从未启用**;
  R2c-R2/R3 与 schema-v2 在生产同样是关的。要不要开、什么时候开,是决策,不是遗漏。
- `research_browser` 的代理模式下域名不做本地解析(只对字面 IP 兜底),
  此时 SSRF 防护全靠代理侧——与 `WO-FIX-SEC-03` 自陈的"代理侧 DNS 无法由 URL
  guard 证明"是同一件事的两个视角。**该残余风险至今无承接方**(F2)。

## 落点

修复三条 + 事故修复一条在 `wo/fix-outbox-cursor`,合并包 10。
本记录同时把 BASE-01 §修正注记 3 这条遗留正式**销账**。
