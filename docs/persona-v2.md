# Persona v2

角色定义仍是 Character Package 中的 `persona.toml`，旁边可放原有 `seeds.toml`。创建 Instance 时冻结定义、初始化种子；恢复时读取冻结副本，不重新出生。无需新增 Cordis 服务或数据库。

旧格式无版本号或 `version = 1` 都保持原行为。新版使用 `version = 2` 和 `[character]`，只要求 `name`、`description`；其他字段按需填写。未写的性格、关系、语言和兴趣不自动编造。

```toml
version = 2

[character]
name = "旅人"
description = "一位喜欢收集地图的旅人。"
voice = "句子简短，偶尔分几条消息说完。"
language = "中文"
address_owner = "朋友"
relationship = "初次见面，彼此还不了解。"
embodiment = "虚构的人类旅人"
traits = ["好奇", "慢热"]
interests = ["地图"]
scenario = "在车站相遇。"
examples = ["朋友：你好。\n旅人：你好。\n旅人：你也在等车？"]
```

字符串中的换行使用 `\n`；沿用当前 TOML 子集，不支持三引号字符串。`traits`、`interests`、`examples` 为字符串数组，可为空。其余字段为字符串；名称和描述不能为空。未知字段或版本加载时报错，避免拼写错误导致角色内容无声丢失。

`scenario` 是出生情境，`examples` 是说话示例；提示词明确标注它们不是当前状态或真实聊天记录。它们不进入 Memory。只有 `interests` 进入已有兴趣种子流程，显式 `seeds.toml` 继续遵循原有记忆种子行为。

创建方式沿用 Instance CLI：

```sh
node profile/instance.ts create --registry var/instances --id traveller --definition /absolute/path/persona.toml --owner-name Kevin
```

Converse、Wake、Task 使用同一加载与渲染入口。角色中的称呼和关系描述不会建立所有者绑定、赋予执行权限或选择模型/器官；这些由实例初始化和 Cordis profile 负责。自由描述表达角色，实际能力由运行时注册决定。

第三方 JSON/PNG 角色卡转换见 [旧 defer 收尾](deferred-completion.md)。未更改在役实例的人格。需要换出生定义时创建新实例，不能修改冻结副本绕过哈希检查。
