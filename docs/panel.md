# Panel

`lykoi-panel` 是一个 Cordis 插件，为当前运行实例提供本机所有者控制台。浏览器没有独立人格、任务队列或业务数据库。前端是原生 HTML/CSS/JavaScript，无构建步骤和新增 UI 框架。

```text
Browser → lykoi-panel → Cordis services
                       ├─ Converse.sendOwner / history
                       ├─ Task.command / list / history
                       ├─ Mind.view
                       ├─ Skill.list / read
                       └─ Runtime capabilities / instance · Heart
```

`converse` 和 `lykoiRuntime` 是注入依赖。其余服务在每次请求时读取：未装配显示缺席，读取失败显示错误。页面每五秒刷新可见页的状态；没有伪造“正在思考”的活动。Mind 显示持久理解，不显示原始模型思维链。方法正文用文本展示，不执行方法里的 HTML。

## 本地体验

在仓库根执行 `npm ci`、`npm run panel`，打开 `http://127.0.0.1:3210`。启动程序通过现有 Instance supervisor 创建/恢复 `var/panel/instances/panel-demo`，保留正常实例锁与排空退出流程。Ctrl+C 停止。重开保留这个合成实例的数据。

体验装配 `profile/cordis.panel.yml` 明确使用固定 mock 回复，零真实模型/外网调用；其历史与任务仍走真正的持久服务。它不证明模型理解目标或执行目标中的工作。

## 接入已有实例

在该实例实际使用的 Cordis profile 加入以下条目，然后通过原实例启动/部署流程加载：

```yaml
- id: panel
  name: lykoi-panel
  config:
    port: 3210
```

Panel 只监听 `127.0.0.1`，不提供公网/多用户登录服务。本机进程与能访问该回环端口的用户拥有所有者控制台权限。浏览器请求校验 Host、Origin 和 Fetch Metadata，写请求仅接受有大小限制的 JSON。远程访问使用保持本地端口 3210 的 SSH 转发；不要把端口通过反向代理公开。要支持多用户远程访问时，再增加明确的身份鉴权层。

任务创建和控制调用现有、带审计的 `/task` 所有者入口；Panel 不提供任意 capability.invoke 接口，不改 Kernel 的审批规则。Task 详情可核对参数并批准当前待审操作。`Converse.sendOwner` 复用同一 `Conversation.send`，把需要审批的动作交给已有 ApprovalConversation，在实例绑定通道提问；没有通道或拒绝静默期时明确返回不可用，不冒充已建立审批。审批答复与异步成果推送继续使用已有通道；Panel 不抢占 `Task.bindInteractions` 的单一交付绑定。页面看到成果不自动记作 `sent`。

## HTTP 与状态

- `GET /api/state`：当前实例、能力/器官、Mind 工作集、任务、近期方法、Heart、最近 50 个持久对话回合。
- `GET /api/mind?query=...`：当前及历史理解检索。
- `GET /api/skills?query=...&offset=...` / `?id=...`：分页检索和正文。
- `GET /api/task?id=...&offset=...`：任务与分页操作记录。
- `POST /api/chat`，`{text}`：复用 Converse 的锁、预算、认知循环及持久历史，返回该回合自身的 outcome 和 utterances。
- `POST /api/task`，`{command,id?,text?}`：有限的所有者 Task 命令。

HTTP 超时/断线不表示执行已经撤销。前端保留未确认的输入，提示先检查历史与任务，不自动重发写请求。插件卸载停止新 HTTP 请求，并等待在途请求结束后释放端口；不删除实例数据。

后续人格包、人格接线、生产执行能力及多模态继续依既定建设顺序推进。本批不新增通道 Hub、UI 插件市场、工作流或第二套状态服务；真实接入第二个独立消息通道时再评估通信路由。
