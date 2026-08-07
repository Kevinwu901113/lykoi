# WO-FIX-P3-01：自主动作工作目录隔离

你是 Lykoi 治理平面的执行 Agent。允许修改代码，仅在工单分支，不得合并。

## 现状（已核实）

- `src/lykoi/resources/terminal.py` 的 `exec()` 调用 `asyncio.create_subprocess_exec(*argv, stdout=…, stderr=…)`，**不传 `cwd`**，因此继承父进程工作目录。
- `lykoi-autonomy.service` 的 `WorkingDirectory=/home/lykoi/projects/lykoi` —— **即代码仓库根**。
- 全仓 grep `workspace|WORKSPACE` 在 `src/` 下**无任何命中**：不存在工作区概念。

**实际后果（已发生）**：核心仓库根出现过两个未跟踪文件——`P`（一个繁体中文网页 HTML 存档）与 `|`（curl 生成的 cookie 罐，域名 www.uni-lions.com.tw），时间戳 2026-07-29 23:23。这是自主探索时 curl 参数错位、相对路径落在仓库根造成的。**内容无害，问题是结构性的：她的自主行动默认把产物写进自己的代码仓库。**

风险不止脏文件：写进代码树的文件可能污染完整性清单核验、被误提交、或与源码同名造成混淆。

## 目标

给自主行动一个专属工作区，让所有相对路径产物落在那里，而不是代码仓库。

### 要求

1. **工作区路径**：新增环境变量 `LYKOI_AGENT_WORKSPACE`，默认 `/home/lykoi/workspace/autonomy`。目录不存在时由代码创建（`mkdir -p`，不要求 root）。
   - 注意 `/home/lykoi/workspace/` 已存在且有内容（治理工单报告等），**只使用其下的 `autonomy/` 子目录，不要动同级其他内容**。
2. **`terminal.exec` 传 `cwd`**：默认为工作区。
3. **允许调用方指定子目录，但必须做路径逃逸校验**：若 `params` 带 `cwd`，解析为绝对路径（`os.path.realpath`）后必须仍在工作区内，否则拒绝并抛出明确异常。要防住 `../`、符号链接、绝对路径三类逃逸。
4. **检查同类问题**：逐个排查 `src/lykoi/resources/` 下其他资源是否也依赖继承 cwd 写相对路径（重点看 `research_browser.py` 的下载/截图落点、`browser.py` 的截图落点）。已知 `LYKOI_SCREENSHOT_DIR` 是绝对路径配置——确认它是否真的总是绝对路径，若可能为相对值则同样需要处理。**如实列出你排查了哪些、结论是什么。**
5. **不要改 systemd 单元**：那是 root 属主、且改 `WorkingDirectory` 会影响整个进程的相对路径解析（包括 Python 模块加载），风险大于收益。本工单只在代码层解决。
6. 补测试：默认落点正确、`cwd` 参数在工作区内可用、三类逃逸（`../`、绝对路径、符号链接）均被拒绝。测试不得真的执行危险命令，用无害命令（如 `pwd`）验证落点。

## 纪律

- 从 main 新建分支 `task/wo-fix-p3-01`，提交前缀 `[WO-FIX-P3-01]`。
- 禁区：`/home/lykoi/secrets`、`core.sock`、systemd/进程操作、写 `/home/lykoi/state`、写活体检出。
- 不得合并到 main。

## 验证要求

1. 相关测试通过（列出文件与结果）。
2. `git diff` 全文。
3. §4 的排查清单（查了哪些资源、各自结论）。
4. 给主治理 Agent 的实跑检查点 3-5 条。

## 输出要求

**不要写报告文件；stdout 即报告。**第一行 `# WO-FIX-P3-01 执行报告`。禁止对话性语句，禁止用摘要代替明细。

## 附：部署时需一并处理（写给主治理 Agent，不需要你做）

活体仓库根的 `P` 与 `|` 两个未跟踪文件应在部署本工单时一并删除——它们是本问题的历史产物。
