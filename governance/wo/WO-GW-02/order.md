# WO-GW-02 · Delegation Gateway 执行面(T1 Runner + broker + Core 词表)

> **状态:已签发(2026-08-22)。** 阶段 2 步 3 后半。上游:WO-GW-01 复核 PASS
> (数据面+管线面已入活体,合同状态机推到 `dispatched` 即停——**执行器就挂在
> 这个状态上**);其报告 F′ 节是你的交接清单正本(本目录 `gw01-report.md`)。
> 冻结设计:`phase2_joint_design_v1.md` §3.3/§4.2/§4.3/§5-步3(judging 依据)。
> **分支与基**:`wo/gateway-02`,基 = `32238013`(活体尖,**并行基**——同机另有
> 执行器在跑,manifest 重签冲突由合并包统一重签解决,l2s3 先例)。

你是执行 Agent,在 `~/lykoi-work-gw` 工作,分支 `wo/gateway-02` 已由治理侧
建好,直接 checkout。铁律:前台串行、**禁后台**、每判据一 commit(`[WO-GW-02]`
前缀)、测试 `timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与
冻结设计或本单冲突时,停下写清楚。**并行执行注意(教训 38)**:同机另有执行器
在跑,若全量中 `test_core_v1_shadow` 出现 TimeoutError 连锁失败,记录后对该
文件单独串行复跑一次定性,勿逐条归因。

## 范围一句话

把 GW-01 停在 `dispatched` 的合同接上真实执行:**六处 origin 词表扩展(Core
schema 版本变更)→ T1 Runner(独立 OS 用户 + Claude Code 无头 Runtime)→
broker(http_proxy 型 LLM handle)→ S4a §4.3 四条的可测执行面**。活体四条
实测与真实委托走通属合并包 E 步,你交付代码+测试+部署件。

## 判据

① **侦查先行(单独一节入报告,引用代码行)**:
   a) GW-01 报告①d 的六处 origin 词表逐处复核现状(两处 SQLite CHECK 的
      迁移哈希钉死机制、绊线测试 `test_gw01_delegation.py:314` 现值);
   b) `dispatched` 状态的消费侧挂点——谁轮询/谁认领,与 `autonomy` 循环、
      `scheduler.py` 的既有形态对比,选最小侵入宿主并论证;
   c) 现有 systemd 单元文件的仓库登记形态(五个 .service 怎么进 repo、
      drop-in 怎么交付)——lykoi-broker/lykoi-runner 照此登记;
   d) `secrets/handles.yaml` 载体:仓库内放**占位样例**(真值 root 侧,
      合并包事项),broker 读取路径的权限假设写明;
   e) 代理箱现状(192.168.0.202:7890)与合同 `network.allow` 编译成
      Runner 侧网络白名单的可行形态(实测不了的写明假设)。

② **六处 origin 词表扩展(头号硬前提,GW-01 交接清单 §3)**:`delegated`
   进入全部六处;两处 CHECK 走**新版本迁移**(禁改既有 `_V1`,迁移哈希机制
   照 shadow 既有阶梯,升降各配测试);绊线测试按其自述"扩词表那一刻必红"
   → 按设计更新为新的钉死断言(六处全含 delegated);**未扩词表前 delegated
   派发被 shadow 静默吞**的负例先钉后修(先红后绿入 commit 说明)。

③ **T1 Runner(§3.3)**:`lykoi-agent-1` 独立 OS 用户形态——代码交付:
   Runner 启动器(从 `dispatched` 合同编译出生环境:工作目录、**不继承
   env**、合同 YAML 注入、网络白名单参数)、Claude Code 无头 Runtime 调用
   形态(参数化,测试用假 Runtime 替身)、收据回收(`add_receipt()` 唯一
   写入点,`verdict` 留验证平面不动)。合同状态机迁移 `dispatched→running→
   completed/failed` 全程审计(GW-01 事件类照用);**depth≤1/max_child_agents=0
   在执行面同样无路径**(负例)。用户创建/系统安装归部署脚本(见⑥),代码
   不假设用户已存在(探测+清晰报错)。

④ **broker(§4.2,http_proxy 型先行)**:独立进程(`lykoi-broker` 用户,
   systemd 单元入 repo);读 handles.yaml(占位样例);发放一次性会话票据
   **绑 contract_id**(挂点=`audit_session_id` 确定性派生,GW-01 交接 §2);
   反代注入真 key、`allowed_paths` 白名单拒绝越界;**合同 `state IN
   ('expired','rejected') → 票据失效**(每次校验读库,索引已就绪);每次
   出借落 `secret_handle_grant` 到既有 sink。scoped_token 型不做(S4b)。

⑤ **S4a §4.3 四条的可测执行面**:
   ① `/proc` 读不到 key——Runner 环境构造的单测(env 白名单断言)+ 活体
      实测步骤写进部署核对;
   ② 直连被拒——network.allow 编译结果的单测 + 活体实测步骤;
   ③ 经 handle 反代成功且审计有记录——broker 集成测试(假 upstream)
      断言 key 不出 broker + `secret_handle_grant` 落账;
   ④ 过期票据失效——状态迁移后票据校验拒绝的测试。
   四条各一测试;活体版四条写成可粘贴验证脚本(部署核对节)。

⑥ **部署件**:systemd 单元文件 + 用户创建/权限布置的幂等脚本(root 执行,
   注释写明每步为什么)+ 合并包核对清单(新单元、新用户、handles.yaml 真值、
   Core schema 迁移执行时机与单元重启面、六处词表的 root 封存事项)。

⑦ **零扰动**:不发起 delegation 时全系统行为逐字节不变;`conversation`/
   `telegram_device`/`app.py`/`mind/decide.py`/U3 切换键零 diff;新增常量
   安全缺省、无新必需 env;Runner/broker 不装不影响既有五服务。

⑧ **全邻接前台串行 + manifest 重签 + conftest**:全量基线 **2169/3/6**
   (基 `32238013`;先复跑核实再动手,对不上停下写清楚);新增失败零容忍
   逐条解释;manifest 前后条数写明(以基分支现值为基准,预期 112);新增
   state/env 常量同提交补 conftest(教训 36)。

⑨ **报告(stdout 本体)**:①全节;每判据自证;C-C 交接清单(首个 coding
   器官委托=lykoi-ui 低风险小修的 2026-08-09 决议,从"她发起 delegation.
   dispatch"到"收据回来"还缺什么);S4b/步 4(shadow 解钉+reliability 回填)
   留白确认。

## forbidden

不碰真实 secrets(handles.yaml 真值、llm.env、任何 key 材料——占位样例
明确标注 PLACEHOLDER);不动 guardian/ 代码(manifest 重签除外;
`HARD_ASK_TYPES` 加固由治理侧随 U3S 落地捎带,你不做);`approval_rules`
永无写路径;她无任何自批路径(delegation.dispatch 的对话门不放宽);不做
scoped_token/S4b/自动轮换;不做步 4 shadow 解钉与 reliability 回填;不碰
对话路径与 U3 切换键;不动 `mind/`/`cognition/` 自主循环(WO-CB-01 领地,
同机在跑——若②的 core 迁移触及其测试 fixture,只改测试侧并逐条说明);
不真装系统用户/单元(交付脚本不执行——工作副本无 root,探测+跳过);新增
state 路径常量同提交补 conftest;凡与冻结设计冲突的侦查发现,停下写清楚。
