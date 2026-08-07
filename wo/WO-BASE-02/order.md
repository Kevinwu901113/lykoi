# WO-BASE-02：架构图、数据流图与信任边界图（只读）

你是 Lykoi 治理平面的执行 Agent。本工单为**纯只读分析**任务，产出白皮书 31.3 要求的三类图。

## 输入

- 代码仓库 `/home/lykoi/projects/lykoi`（你的工作目录）
- 前序成果可读：`~/workspace/wo/WO-BASE-01/report.md`（模块清单、进程映射、配置面——直接复用，不要重复清点）

## 硬约束（禁区）

- 只读：不修改任何文件、不切分支、不运行任何有副作用的程序
- 不访问 `~/state`、`~/secrets`、`core.sock`、网络
- 引用配置只用变量名，不读值

## 任务

### 1. 组件架构图

Mermaid `graph TD`：4 个运行进程 + 8 个包 + 存储层（state 各文件/DB，只标名字）+ 外部依赖（LLM API、Chrome CDP、noVNC、Mac 客户端、cron）。边 = 真实的调用/导入/IPC 关系（HTTP、Unix socket、文件读写），关键边注明证据（文件:行号）。

### 2. 数据流图（每条一个 mermaid 图）

a. **用户消息流**：客户端 → surface `/chat` → cognition → LLM → 记忆写入 → 回复
b. **自主循环流**：tick → snapshot → decide → dispatch（白名单/审批分叉）→ reflow → 状态写入
c. **感知上行流**：`POST /ingest/environment` 之后数据落到哪里、被谁消费（如实标注实现现状，包括"接收后未消费"这类结论）
d. **后台流**：scheduler 周期任务 + cron（notify_push、offsite_backup）

每条流在图后附 3-6 行文字说明与关键证据（文件:行号）。

### 3. 信任边界图

Mermaid 图划出信任域：root 域（systemd 单元、/usr/local/sbin 控制器、watchdog、runtime/governance 只读开关）、lykoi 用户域（四进程、state、secrets）、浏览器域（Chrome + browser-profile）、外部域（LLM API、GitHub、公网网页）、客户端域（Mac app / CLI）。标出每条跨界通道及其防护机制（token 认证、loopback 绑定、root 只读文件、文件权限）。

### 4. 边界缺口清单

对照代码找出的实际缺口，每条必须给代码或配置证据，按严重度排序。至少核实这三个白皮书已点名的方向（证实或证伪都算结论）：
- 持久浏览器与核心同用户运行的影响面（CDP 9222 谁能连、Chrome 进程能读哪些路径）
- Protected Paths 声明在资源路径上的强制情况（找到声明位置和实际 enforce 调用点，列出未覆盖的路径）
- `_TOKEN` 类字段的日志脱敏覆盖（脱敏函数在哪、哪些日志出口没走它）

## 输出要求（严格遵守——上一轮因违反被打回）

- **不要尝试写任何文件。**你没有写权限，也不需要写：调用方已把你的 stdout 重定向存档为 report.md。
- **stdout 就是报告本体。**第一行必须是 `# WO-BASE-02 架构图、数据流图与信任边界图`，最后一行是报告正文的结尾。
- 禁止任何对话性语句："我已完成""由于权限限制""请授权""需要继续吗"等一律不得出现。
- **禁止用摘要代替明细。**上一轮只交了 56 行摘要且没有一张 mermaid 图，被判不合格。本轮必须包含：第 1 节 1 张组件图，第 2 节 4 张数据流图（a/b/c/d 各一张），第 3 节 1 张信任边界图，**共 6 张 mermaid 图，一张都不能少**。
- mermaid 用 ```mermaid 围栏代码块。每个结论附证据（文件:行号）。不确定标"待核实"，不要猜测。
- 篇幅宁长勿略；开头给 10 行以内执行摘要，然后是全部明细。
- 第 4 节缺口清单：上一轮已给出三条（log_event 未脱敏、持久浏览器无 SSRF、screenshot 路径未校验），主治理 Agent 已独立验证属实，**本轮请在此基础上继续深化**：给出每条的完整调用链证据、影响面（谁能触发、能读写什么）、以及是否存在部分缓解。
