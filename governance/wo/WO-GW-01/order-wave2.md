# WO-GW-01 · 续跑单(第 2 波) · Delegation Gateway 数据面+管线面收尾

**为什么是续跑单**:第 1 波 attempt 1 于 2026-08-19 21:55 CST 撞账号 session limit
中断(非工单问题,非你的问题)。判据②–⑥的实质 commit 已在分支上,**禁止重做**;
你的任务=清理 WIP、重建①侦查节、校验存量、补齐⑦⑧⑨、出完整报告。

你是执行 Agent,在 `~/lykoi-work-gw` 工作,分支 `wo/gateway-01` 已 checkout,
工作树干净。冻结设计正本本次会话可直接读:
`~/wo/WO-GW-01/phase2_joint_design_v1_2026-08-09.md`(§2/§3 是判据依据)。
铁律不变:前台串行、**禁后台**、每判据一 commit(`[WO-GW-01]` 前缀)、测试
`timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与工单或存量
commit 冲突时,停下写清楚。

## Do-not-redo 表(已在分支,只验不重做)

| 判据 | commit | 内容 |
|---|---|---|
| ② schema 最小子集 | 525a0210 | delegation_contracts + execution_receipts,v14→v15,可逆迁移 |
| ③ kernel 扩展 | 3c365eb1 | 第五个 origin "delegated" + DelegationRef |
| ④ delegation.* 三资源 | 12af1785 | 走既有管线+分级(dispatch 对话门,status/collect 免询) |
| ⑤ delegation_* 审计事件 | 9577a3ab | 新增套件 61 条 |
| ⑥ 零扰动 | 45a7afe2 | 不用 delegation 时全系统逐字节不变 |
| (WIP) | d7a2c96c | 中断时自动保存:manifest 半截重签 + `scripts/patches/_gw01_segments.py` |

## 本波任务(按序)

A. **清理 WIP d7a2c96c**:`scripts/patches/_gw01_segments.py` 若是你上一波的
   脚手架(非交付物)则删除,manifest 的半截重签一并回退(留到 E 步统一重签),
   单独 commit `[WO-GW-01] 清理: attempt1 中断残留`。若判断该文件是交付物,
   报告里说明理由并保留。
B. **重建判据①侦查节**:原判据① a–e 五点(见附录原文),引用代码行写入报告。
   上一波的侦查结论随中断丢失,此节必须完整重建。只读侦查不产生代码 commit;
   特别注意①c——若结论是"必须改 guardian 代码",停下写清楚(存量④⑤若已
   隐含改了 guardian,同样停下)。
C. **存量校验②–⑥**:逐条跑其新增套件+关键负例,自证不改动;发现缺陷才改,
   改必单独 commit 并在报告标注"第 2 波修正"。
D. **判据⑦全量**:kernel 邻接全套+dispatch 消费方套件+新增套件;全量基线
   **2108/3/6**(基 `7b00ae5e`);新增失败零容忍逐条解释。前台串行,禁后台。
E. **判据⑧ manifest 重签**:前后条数写明(基线 110);dispatch.py 属 kernel
   root 封存,合并包 root 事项写进报告。
F. **判据⑨报告(stdout 本体)**:①全节;migration 执行时机与单元重启面;
   GW-02 交接清单(Runner 出生环境需要的接口点、broker 票据绑定 contract_id
   的挂点、§4.3 四条的可测前提);每判据自证(含存量五条的校验证据)。

## forbidden(原样继承)

不做 Runner 进程管理、不碰 broker 与 secrets(GW-02 领地);不动 guardian
代码(若①c 判定必须动,停下);不碰 conversation/telegram/surface(U 线领地);
不做 §2 数据模型全量(只取本单子集);approval_rules 永无写路径;她无任何
自批路径(委托审批与既有对话审批同门);不动 U3 影子与切换键;新增 state
路径常量同提交补 conftest;凡与冻结设计或本单冲突的侦查发现,停下写清楚。

---

## 附录:原工单判据全文(第 1 波原文,供①B 重建与存量校验对照)

① **侦查先行(单独一节入报告,引用代码行)**:a) users 表现状——身份绑定用的
   user_001 背后是什么表、有无 role 概念,`agent_user_id REFERENCES users(id)`
   如何最小落地;b) mind_schema 当前版本与迁移阶梯纪律(L5 曾补逆迁移梯子,
   照做);c) `guardian` audit sink 对新事件类是否零改动可用(事件名是数据还是
   代码枚举)——**若需改 guardian 代码,停下写清楚**;d) `kernel/dispatch.py`
   的 DispatchContext 扩展点与 origin 消费方全景(谁读 origin、加值会不会
   漏 case);e) shadow 侧写对新资源类型的自动覆盖面。
② **schema 最小子集**:`delegation_contracts` + `execution_receipts` 两表照
   §3.2 SQL(含 state/verdict CHECK 与 json_valid);users 侧按①a 的最小加法
   (够引用完整性即可,不做 §2 全量);版本 +1、**可逆迁移**(升降各配测试)、
   conftest 默认表同步(教训 36)。
③ **kernel 扩展(加法不重构)**:`DispatchContext.origin` 增 `"delegated"`;
   `DelegationRef` frozen dataclass 四字段照 §3.2;`origin=="delegated"` 时
   `delegation` 必填的校验(缺=拒绝派发,审计落账);**既有四个 origin 的行为
   逐字节不变**(①d 的消费方逐个配对照断言)。
④ **`delegation.*` 资源**:`delegation.dispatch` / `delegation.status` /
   `delegation.collect` 走既有 dispatch 管线,测试证明**三继承**:审批门、
   immutable audit(fail-closed)、shadow 侧写。policy 分级:`delegation.dispatch`
   默认**对话门(ask)**——她发起委托必须过审批,无免询路径;status/collect
   只读=免询。合同状态机照 §3.2 CHECK 七态,非法迁移拒绝。`max_child_agents=0`
   语义预埋:`depth` 字段存在但本单强制 ≤1 且子代理再委托无路径(负例测试)。
⑤ **审计事件类 `delegation_*`**:contract_id/session id 全程携带,经既有
   audit sink;每个状态迁移一条;fail-closed 语义不变。
⑥ **零扰动**:不使用 delegation 时全系统行为逐字节不变;新常量全部安全缺省,
   无新必需 env;`conversation`/`telegram_device`/`app.py`/U3 影子/切换键/
   `mind/decide.py` 零 diff。
⑦ **全邻接前台串行 + p0**:kernel 邻接全套 + dispatch 消费方套件 + 新增套件;
   全量基线 **2108/3/6**(= 2077/3/6 权威值 + approval-delivery 新增 31,基
   `7b00ae5e`);新增失败零容忍逐条解释。
⑧ **manifest 重签**(现 110,前后条数写明;dispatch.py 属 kernel root 封存,
   合并包 root 事项写进报告)。
⑨ **报告(stdout 本体)**:①全节;migration 执行时机与单元重启面;GW-02 交接
   清单(Runner 出生环境需要的接口点、broker 票据绑定 contract_id 的挂点、
   §4.3 四条的可测前提);每判据自证。
