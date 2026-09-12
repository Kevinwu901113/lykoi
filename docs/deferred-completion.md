# 旧 defer 收尾

本批复用已有 Cordis 服务，新增的是可使用的入口和缺失的语义，不增加一套执行框架。

## 角色包

原生定义见 [Persona v2](persona-v2.md)。转换 Character Card v1/v2.0/v3.0 的 JSON 或 PNG：

```sh
node profile/character-import.ts /absolute/path/card.png /absolute/path/new-package Kevin
node profile/instance.ts create --registry var/instances --id traveller --definition /absolute/path/new-package/persona.toml --owner-name Kevin
```

转换后 `persona.toml` 是可运行定义，`source.card` 是逐字节原件，`import.json` 列出未启用内容。`{{char}}`、`{{user}}` 在导入时展开，v3 使用 nickname（若有）；其他宏保留字面值并报告。PNG 同时含 `ccv3` 与 `chara` 时优先 v3。

描述、性格、情境、开场白及对话示例被映射；开场白是风格示例，不自动发送。世界书、外部资源、alternate/group greetings、system_prompt 和 post_history_instructions 只保留在原件并明确报告未启用。Lykoi 不承诺完整 Tavern 前端语义兼容，也不让导入卡接管 Runtime 协议。作者说明和扩展元数据保留在原件，未混进角色提示词。

格式依据：[Character Card v2](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)、[Character Card v3](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)。

## 后天人格

沿用实例的 `mind.sqlite`、Mind 事务、来源证据和版本控制。新增 `self` 表达从经历形成的自我理解；`moment` 表达有对象和情境的短期关系态，并要求 `expiresAt`。到期只退出默认工作集，历史可搜索；不自动判定情绪、不按次数加减人格分数。

Converse 与 Wake 可通过同一个 Mind patch 修订；Task 同时读取默认工作集和任务相关记录。`self` 不修改冻结出生定义或权限。旧 `narrative_versions` 最新可认知叙事作为可重新评估事件交给 Mind，`narrative_only` 不进入此路径；事件 ID 去重，已处理事件不会在重启后反复投递。因此新路径不依赖旧 `narrativeFlag` 文件，也没有再造第二份 Learned Self 库。原有 persona/preference insight 投影保留。

## 图像

修复旧视觉接线把 base64 当文字的问题。使用官方 `@deepseek-ai/dsh-attachment-local`，通过 Cordis `attachments` 服务持久化和校验图片，以 Harness `image` 内容块交给现有预算化 LLM。附件目录由 Instance 固定到自身 `stateRoot/media`。

Panel 支持 PNG/JPEG/WebP/GIF 单图上传（8 MiB），由视觉模型描述后进入现有 Converse。图片源字节不塞进聊天日志；描述明确标作观察资料。截图描述同样使用修正后的图像路径。附件插件或视觉接线缺席时，上传入口不可用；卸载即失效。

这批完成 Panel 图像输入和截图识别接线，尚未实现 Telegram 图片接收、音频和视频。生产当前文本模型没有已确认视觉供给，`visionRoute/visionModel` 保持 disabled；接入真实图像模型需在签名 profile 装配支持图片的适配器及路由，不能用填一个名字冒充供给。官方附件契约见 [Harness attachments](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/attachment.md)。

## 并行 Instance

同一 registry 可显式 `run --id a`、`run --id b`，各自独立进程，使用不同 Panel 端口/渠道凭据和配置。锁从 registry 移到各自 `stateRoot/.active`；生产入口也取得同一把锁，重复启动同一状态库被拒绝。旧 registry 锁中仍有活进程时先停止旧实例。

`select` 仅决定后续默认启动对象，不能改正在运行的实例。没有引入角色间分配任务或多 Agent 编排。生产 Gate 仍保护现有单生产实例，开发多实例能力不等于可以复用一份生产状态/凭据/端口。

## 生产装配与验收

签名生产 profile 已加入 Panel、Workspace、Pi Runner 和附件存储。文件操作继续经过已有 Capability/Kernel 门；Pi 继续由 Persistent Task 发起并记录真实回执。没有自动批准 `terminal.exec` 或 `delegation.dispatch`。Pi 执行使用部署用户的 OS 权限，workspace 是 cwd，不能当作 OS 沙箱。

2026-09-12 只读现场核对：生产提交 `9bb57eb`，服务 active/running，NRestarts=0；治理 SSH 无 root 写入/重启权限，PATH 未发现 Pi。源码装配完成不等于在役启用。

准备的 [root 升级脚本](../governance/wo/WO-DEFERRED-COMPLETION/upgrade.sh) 接收本次 bundle 与完整提交 SHA；安装固定 Pi、校验基线、停止服务、备份状态、升级依赖、重签 Gate 后启动。任何失败停在该步，不自动回滚正在演化的状态。备份和凭据不得进 Git。回退需停稳新服务，恢复备份的 state/instances/governance 和记录的 previous-commit，重新安装该版依赖并重签 Gate。

运行后从可信本机 SSH 转发 `3210:127.0.0.1:3210` 访问 Panel，验证真实对话、一个经批准的文件成果及 Task/Pi 回执；状态页可用和测试模型成功都不代替这些验收。

Resolver、Forge、DAG、自动 Skill 晋升与角色间调度继续冻结。现有 Capability 注册/卸载、Task、Runner、Skill 已承接当前需求；本批没有证据要求另造插件内核。
