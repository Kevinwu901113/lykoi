# WO-GW-02 · 续跑单(第 2 波) · 停工裁决:选 A(解耦),完整交付执行面

**裁决(治理侧,2026-08-22 04:0x;呈 Kevin 追认)**:你的停工正当、侦查采纳。
**按 (A) 解耦执行**。理由:①T1 形态下不存在 `origin="delegated"` 落 Core 的
路径(你已实证),"静默丢数据"不在关键路径;②激活 v2/发明 permission_evidence
阶梯 = M3-R1b 与一次独立 Core schema 工程的领地,越权且踩红其专属套件;③冻结
设计 §5 步 4(shadow 解钉)本就是独立步骤,词表扩展自然归位到那一单。

你仍在 `~/lykoi-work-gw` 分支 `wo/gateway-02`(基 32238013,尚无 commit)。
铁律不变:前台串行、禁后台、每判据一 commit、timeout 1800 包裹(全量可分块,
每块独立 1800)、stdout 即报告本体、再遇冲突停下写清楚。**结束纪律**:最终输出
只能是完整报告,任何块没跑完就前台等,绝不以"还在跑"收尾,绝不给自己挂监听。

## 逐项裁决(对应你报告的请示,全部生效)

1. **判据② → 降级为"负例钉死 + 交接文档"**:a) 显式负例测试把现状钉成事实
   ("`delegated` 若落 Core 会被 fail-open 静默吞",引用 fail-open 位置);
   b) 绊线测试 `test_gw01_delegation.py:314` **原样不动**(它继续替未来那单站岗);
   c) 六处词表的完整扩法(含 v3 阶梯要点、permission_evidence 需要发明阶梯的
   事实、与 M3-R1b 的耦合)写成报告的"Core schema 工单交接节"——那是未来
   WO-CORE-DELEGATED-VOCAB 的输入,本单零 Core diff。
2. **判据③ 状态机**:照活体七态 CHECK 实现——`dispatched→running→collected`
   (成功)/`→rejected`(失败),报告写明与原工单文案的映射。原文 `completed/
   failed` 是签发方凭记忆写错(治理侧自领教训 42 同款),以冻结设计与活体
   CHECK 为准。
3. **判据④ broker**:只交付三个真实缺口——①票据校验读库:合同
   `state IN ('expired','rejected')` 即失效(时间过期照旧);②审计事件名对齐
   设计词表 `secret_handle_grant`(落 broker 自有 audit 照旧);**guardian sink
   联写做成配置项、默认关**(跨用户 append-only 写需 root 侧权限布置,生产
   开启与权限方案入合并包核对清单,由 Kevin 裁);③handles 占位样例
   ——**handles.json**(接受 P2-03A 既有偏离,代码注释已记理由),样例标注
   PLACEHOLDER。broker 既有 10 条测试不许回退。
4. **①b 宿主**:采纳独立 `lykoi-runner` systemd 单元,照仓库根平铺登记约定
   (含 `ExecStartPre=startup_verify`,与 core/autonomy 同款)。
5. **①e**:Runner 网络白名单按假设交付 + 活体实测归合并包 E 步,照你写的办。

## 本波交付(= 原判据 ③④⑤⑥⑦⑧⑨,范围经上述裁决修正)

- ③ T1 Runner(七态版);④ broker 三缺口;⑤ S4a 四条可测执行面(四条各一
  测试 + 活体版验证脚本);⑥ 部署件(lykoi-runner 单元、用户/权限幂等脚本、
  合并包核对清单——含 broker 审计联写权限方案、代理白名单实测项);
- ⑦ 零扰动(原文照旧,新增:**Core 零 diff** 是本波的硬断言);
- ⑧ 全量:基线 **2169/3/6**(基 32238013,已由 GW-01 复核在同 commit 上
  权威确立,**不必改动前复跑**;你的改动后全量直接与它对账,分块串行,
  core_v1_shadow 浮动按教训 38 定性);manifest 前后条数写明(基 112);
  conftest(教训 36);
- ⑨ 报告:含判据②的"Core schema 工单交接节" + 判据①已完成部分直接并入
  + C-C 交接清单(原文)。
