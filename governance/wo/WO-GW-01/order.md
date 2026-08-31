# WO-GW-01 · Delegation Gateway 最小闭环 · 第一单(数据面+管线面)

**背景地位**:阶段 2 步 3 的前半,冻结设计=同目录
`phase2_joint_design_v1_2026-08-09.md` §2/§3(2026-08-09 Kevin 批复冻结);
Cordis 接轨方案 C-C 段的硬前置(CD3 提级,Kevin 2026-08-19"先把 cordis 做完"
指令下开工)。第二单 GW-02(T1 Runner + broker 接线 + S4a 四条)依赖本单。
**步 1(数据模型全量迁移)未做——本单只带步 3 够用的最小子集**,不做全量。

你是执行 Agent,在 `~/lykoi-work-gw` 工作。
**分支 `wo/gateway-01` 已由治理侧建好(尖 `7b00ae5e`),直接 checkout。**
铁律:前台串行、禁后台、每判据一 commit(`[WO-GW-01]` 前缀)、测试
`timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与工单冲突时
停下写清楚。

## 判据

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

## forbidden

不做 Runner 进程管理、不碰 broker 与 secrets(GW-02 领地);不动 guardian
代码(若①c 判定必须动,停下);不碰 conversation/telegram/surface(U 线领地);
不做 §2 数据模型全量(只取本单子集);approval_rules 永无写路径;她无任何
自批路径(委托审批与既有对话审批同门);不动 U3 影子与切换键;新增 state
路径常量同提交补 conftest;凡与冻结设计或本单冲突的侦查发现,停下写清楚。
