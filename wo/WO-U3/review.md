# WO-U3 复核 · 2026-08-18

**结论:PASS**(裁决项两条上交 Kevin,见末节)。执行:opus,EXIT=0 单次过,
6 commit,16 文件 +1968/−69,尖 `a923c44e`(基 `2b8c477f` = 活体 HEAD)。

## 复核方独立验证(不采信自报)

1. **Scope/forbidden 逐文件核**:16 文件全在单内;S3/L5 `reply_to` 先行拦截
   diff 为零(问答机改动仅 import + `_send` 盖章);传输层零触碰;guardian/
   仅 manifest;无新增写路径(AST 断言在卷,复核方读源核实 conversation_cycle
   仅 import llm_router/decide/regulation/log)。
2. **policy_exemption.py 源码逐行审**:frozen dataclass 型标记 + 唯一构造
   入口 + `covers()` 纯函数默认 False + 动作白名单仅 `messenger.send` +
   E2 对端精确相等;类别一个字节不从 params 来。与 P1 附文 §2/§3 逐条对应。
3. **`covers()` 位置**:diff 实证在 `approval.check` 硬规则/能力面/always_deny/
   always_allow/scoped grant **全部之后**——只能把默认 ask 的纯文本出站变 allow。
4. **免问不免账**:audit 行新增 `exemption` 栏(伪造记 None),dispatch diff 实证。
5. **manifest 独立重算**(复核方自写脚本):110 条、0 不符、六目录 0 漏保、
   1 不可读(approval_rules 0600,既知);guardian 条目裸文件名格式确认。
6. **切换开关零读者**:全 src grep 唯一命中 = 定义处(conversation_cycle.py:92)。
7. **秘密扫描**:diff 唯一命中为 `os.environ["LYKOI_DEEPSEEK_API_KEY"]` 引用,
   无字面量。
8. **全量独立复跑**(132 文件分 14+块串行,远端 timeout 1700 包裹,复核方
   自切块不沿用执行方分组):**1982 passed / 3 failed / 6 skipped——与执行方
   总数逐位一致**,失败集合完全相同:test_core_v1_shadow redaction._SECRETS ×2
   (基线既有,执行方已在基提交复现)+ p0 manifest 假失败(claude 身份
   approval_rules 0600,教训 27)。零新增未解释。中途两次 ssh 抖动断连
   (与当日网络事件同源),缺块已逐一补跑,无遗漏(14 块对账齐)。
9. **S3 四条断言口径变更**(8037ab95)逐条读 diff:不变量全保留(恰好一次
   send、无增长链、被问动作零执行、pending 排动作不排问句),新增 E1 机制面
   与 E2 认证前提两条。**复核方判定:正当,建议追认**(它们编码 P1 之前的
   世界,P1 附文 §4.1 是 Kevin 已批判据)。

## 亮点(记入执行方信誉)

- 判据②d 实测闭环做得干净:0600 边界如实呈报、audit 因果链钉成回归断言、
  发现 bootstrap 函数零调用点、**盲格如实留空不猜**;
- 影子快照取 `_completion` 留档而非重调 `_assemble`(副作用意识);
- 自查补 E2 认证前提守卫;
- P2 探针"宁漏勿误"方向自洽,并诚实标注一处已知漏检("跑完了"不中"跑了");
- conftest 补 `LYKOI_U3_SHADOW_ENABLED=0`,教训 36 的行为版举一反三。

## 裁决项(上交 Kevin)

1. **S3 四条断言追认**——复核方建议追认(见上 9)。
   **→ Kevin 2026-08-18 已追认**(原话"可以追认",复核中期报告陈述基础上)。
2. **判据②d 盲格**:今天放行的 `always_allow` 条目是裸 `messenger.send` 还是
   scoped 形态,须一次 root 读取闭合 → 已编入合并包 12 的 A0 步。若为裸条目,
   切换单应考虑收窄(E2 之外的宽放行路径)。

## 观察(不阻合并)

- 工作副本 `__pycache__` 有陈旧 .pyc(合并包 B 步清理项,既有纪律);
- P2 白名单召回率低是已知边界,影子 3 天统计后在切换单定补否;
- 时延判据⑥(中位 <15s)本单只交仪器,数据影子期出。
