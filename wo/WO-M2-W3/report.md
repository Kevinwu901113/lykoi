# WO-M2-W3 · 回流与心脏转正 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent 两波（第 1 波 API 断连死于 G-11 半截，遗产=共享 DDL 收口+rw W3
  写面+W1#1/2/3 销账，树健康 230/230；第 2 波续跑单带 do-not-redo 表收口全部交付，
  遗产零重写全采信）；产物 commit：lykoi-cordis `5ae64f5`（基 b07ef2a）
- 复核：独立复跑 **282/282 全绿 + tsc 净**（逐包数字与自报逐位一致：heart 14/reflow 27/
  wake 14 三处新增）；golden devstate mtime 未变（只读纪律成立）；lockfile 仅 workspace
  link+钉版依赖（cordis@4.0.1、dsh-llm@0.1.1-rc.2、schemastery@3.18.1，符合 DSH-STUDY
  定版纪律）；抽查 G-11/G-1/G-5/G-2/G-3 全部落地（heart 对 lykoi-memory/lykoi-decide
  **零 import** 实测）；四条 result 文案对 refsrc reflow.py 逐字节比对全等；SA-47/48
  零写入断言含对照组、SA-31 applyInner 次序有 dispatch 时刻探针——**PASS**

## 交付

1. **packages/lykoi-reflow**（SA-52..72）：executeAndReflow 不可移位三步+末尾恒
   action_result（SA-52/65）；rest→rested、其余六→action_taken（SA-54）；七 kind 逐支
   result 文案逐字（SA-55..63，含 pyStr/pyFloat1 跨语言等价档两处）；counts 口径表逐格
   测试（SA-56/57）；**G-1**：queue_notification 显式分支，未知 kind → 落审计
   `unknown_decision_kind`+按 failed+零 dispatch 断言，永不默默变通知；**G-5**：
   concern_lit_unfollowed 仅 rest/record_note（维持现状，治理理由入注释=取 DA-05 读法②）；
   dispatch 走 DispatchFn 接口位；cheap tick（SA-67..72：contact 24h 超时/沉默异常三条件/
   每沉默期一次/contact_answered 单写入点幂等/regulation_events 耐重启标记；600s 限频在
   wake 驱动层）。
2. **lykoi-heart 转正**（G-2/G-3/G-8）：基线 env clamp(5,360) 默认 30、地板 MIN_REST_MIN 5、
   显著性=salience_shadow.db 读侧新增 selected=1 行数 ≥3（游标尾扫逐字；readOnly+
   query_only 双层防写；sidecar 缺席 fail-quiet 回落纯基线）；G-8(a) 新体形态=自身持久
   状态（var/heart-state.json，R-12 原子写）损坏→fail-closed 默认拍+幂等报警+自愈；
   G-8(b) 地板与到期串联且 arouse 同受地板闸；**G-2 比定案更紧**：对 memory.db 零接触
   （import 面静态钉死），开机首拍 wake soon；claim 合并沿 M1（{beats:N} 可观测）。
3. **packages/lykoi-wake**（SA-169..172）：六阶段顺序逐字（claim 合并消费→yielded/cap
   仲裁→maintain(moment) 一拍恰一次→read→buildMessages→llm(route=autonomous_cognition,
   origin 三归因 SA-172 经 budget runId 贯穿)→evaluateMessage→executeAndReflow→
   applyInner 在 execute 之后(SA-31 探针钉死)→finishRun/bump）；SA-170 失败拍完整接住；
   SA-171 integrate/focus 接口位留 W4；**推演零写入常驻断言**（G-9/SA-47/48：logicalDigest
   全库逐表 sha+对照组+同刻两次 read 逐字段相同）；clock 薄件（W1#7：systemClock 唯一真钟
   读点+VirtualClock stepped 只进不退）；logEvent 统一接 audit（W2#4：snapshot/decide/
   reflow 三注入位全收 audit.record）；插件面 inject [heart,lykoiLlm,audit]+CheapTickDriver。
4. **G-11 落地**：rest note 旧 `load -0.10;按 next_wake_after_minutes 再醒(5-360 分钟)` →
   新 `load -0.10;下一拍由心脏节律决定`（delta 从 CAUSES 插值消灭手写副本；
   candidates.test.ts 改钉新文案）。**列 Kevin 追认清单**（与 G-5/G-6 同批）。
5. **前波遗产（第 1 波）**：lykoi-memory/src/testing.ts=共享 DDL 单一出处（W2#5，含
   autonomy_notes/integration_state/learning_layer_state 三表）；两包 fixture 改造；
   rw W3 写面（lightConcern/tendConcernDescription/appendThreadProgress/appendAutonomyNote/
   bumpWakesSince）+rw-w3.test.ts。

## TODO 销账（本波认领 10 条）

W1#1/2/3（前波销，复核确认）、W1#4（resolveThought 返回契约对拍一致销账）、W1#7（clock
落地）、W1#9（定案：rw 保持库形态，wake 插件持句柄，memory 插件入口保持只读 R-01 不动）、
W2#1（G-11）、W2#4（audit 接线）、W2#5（前波销）全销；W2#2 部分接线（四读数 dev 缺省视图，
权威源归 M3/W5）。

## 新增 TODO（呈 W4/W5/M3）

①store 层遥测事件（thought_resolve_rejected 等）接 audit 的接法 W4 定；②conversationTurnReflow
归 W5（contact_answered 写入点已就位）；③yielded 拍丢弃至下一基线拍 vs 活体 5s 重试，M3 接
interactive_lock 时定夺；④wake 的 dispatch=unwiredDispatch/notifications=empty/organBlock=null
等 M3/W5 接真源；⑤wake 入 profile/cordis.yml 待 M3/W5；⑥COMPRESSED_* regime 以 Clock 注入体
扩展（留位）。

## 偏离蓝图

零。新体形态适配四处（代码注释留痕）：心脏自身持久状态取代 last_wake_at 播种（更紧不更松）；
autonomy_state.next_wake_at 降格档案列；G-1 未知 kind result 文案为必要发明；失败拍 decision
JSON 用 W1#6 既有序列化口径。波及件两处：profile smoke 改 tick(now) 虚拟时刻驱动、cordis.yml
heart 条目换新配置面（heart 转正必然波及）。

## 教训

执行 Agent 断连死亡的续跑单范式再次生效：do-not-redo 表+开工自证（先复现全绿再动手）+遗产
逐件验证结论入报告。前波半截件（G-11 注释改了字符串没改）是"从注释判断完成度"的反例——
续跑单必须点名到代码行级别的半截状态。
