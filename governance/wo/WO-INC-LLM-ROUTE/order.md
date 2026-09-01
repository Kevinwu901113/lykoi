# WO-INC-LLM-ROUTE · 事故单：LLM provider 路由名不匹配（认知断流）

> 2026-09-01 签发。性质：**事故单**，走观察周 W1 例外流程（runbook「升级线」——
> 服务活着但她的每一次思考结构上不可能成功，严重度等同起不来）。
> 批准：Kevin（根证输出回传即批，见下「实证」）。

## 事故陈述

W1 Day 1 读数组合异常：autonomy_wake 子串计数 17、budget.json 全零。root 精确判别
（2026-09-01 晚）：

- `"type":"autonomy_wake"`（精确）＝ **0** —— 自 M4 切换起**无一拍成功**；
- `"type":"autonomy_wake_failed"` ＝ 18，error 一律
  `autonomous model did not return a decision JSON: ''`；
- `budget/charge` 全部 `promptTokens:0, completionTokens:0`，route=`deepseek`；
- M4 夜「首拍实证」用的是同一条子串 grep（`grep -c autonomy_wake`），
  同时命中 failed——**从未构成成功证据**。

## 根因链（五层，逐层已在代码定位）

1. 生产 yml（钉点 5f706bd）wake/converse 配 `route: deepseek`；
2. lykoi-llm-deepseek vendor 只注册写死常量 `deepseek-official`
   （vendor/index.js:1628 `const PROVIDER`；:1837 `registerAdapter([PROVIDER])`；
   配置面无改名位）；
3. dsh-llm 对未注册 provider 抛 `NO_ADAPTER`（lib/index.js:1529），且 dispatch 期
   抛错被 `adapterFailureChunk` 归一成 `finish{kind:'error'}` 终止 chunk——不外抛；
4. lykoi-llm 只收 text/usage、**不检查 finish 失败位**，返回空文本并按 usage 缺席
   记 0 账（src/index.ts:116 TODO(M2) 路径）——budget.json 里 `deepseek: 0` 键的
   存在即「有调用且全部失败」的物证；
5. wake 阶段 5 解码空串才炸出上面那句 error；SA-170 使失败只落 audit 不写
   journal——读数④干净由此自洽。

## 定案

- **D-INC-1**：路由名以 vendor 常量为准，配置面就位——wake/converse
  `route: deepseek` → `deepseek-official`。不动 vendor（剥头逐字保留纪律）。
- **D-INC-2**：`model: deepseek-chat` → `deepseek-v4-flash`（老体实证主模型，
  且在 vendor DEFAULT_MODELS 目录；deepseek-chat 两头都无凭据）。
- **D-INC-3**：budget `dailyRouteTokens` 键随路由改名为 `deepseek-official`；
  账本旧 `deepseek: 0` 键留作历史事实，不迁移不清理。
- **D-INC-4**：最小修复面——只动 `profile/cordis.prod.yml` 的值。
  lykoi-llm 吞 finish 失败原因（报错晚一层、耗一轮诊断）是真实缺陷，
  **记跟进项**，观察周后随认知线处理，不入本单。

## 验收标准

1. main 修正提交 + 重钉 m4-switch（= 新 main + 翻位 cherry-pick；FLIPS=6，
   route/model/budget 键六处断言全过）。
2. 落地稿全绿：树钉新 sha、manifest 重签、八检查项 gate、assembly up。
3. **事后实证**（等自然醒拍，最长心跳基线 30 分钟）：audit 出现
   `"type":"autonomy_wake"` 精确匹配 ≥1，且对应 `budget/charge` tokens > 0。
   若首拍报新错误（如 MISSING_CREDENTIAL）→ 本单不关，继续追。

## 禁改面

packages/*（含 vendor）、path-guard、gate 检查项、manifest 之外的任何生产面。

## 执行形态

治理侧直接出树（纯配置值修正，沿 WAVE-OBS-PREP 重钉先例，不派执行 Agent）；
服务器侧 root 粘贴稿（Kevin 手跑）。
