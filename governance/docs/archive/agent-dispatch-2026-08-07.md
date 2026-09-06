# 2026-08-07 执行器配置历史

以下是当时的模型、权限参数和调用示例，仅供事故追溯，不是现行用模或派发要求。重用前核验当前 CLI、权限与网络条件。

### 派发命令模板

**分析类（用 opus[1m]）**：

    ssh lykoi-gov 'bash -lc "cd ~/lykoi-work && claude -p --model \"opus[1m]\" \
      --allowedTools \"Read,Glob,Grep,Bash(ls:*),Bash(find:*),Bash(grep:*),Bash(wc:*),Bash(head:*),Bash(sed:*)\" \
      < ~/wo/<WO-ID>/order.md > ~/wo/<WO-ID>/report.md 2> ~/wo/<WO-ID>/run.log; echo EXIT=\$? >> ~/wo/<WO-ID>/run.log"'

**实现类（用 sonnet，加 Edit/Write 与 acceptEdits）**：

    ... claude -p --model sonnet --permission-mode acceptEdits \
      --allowedTools "Read,Glob,Grep,Edit,Write,Bash(git:*),Bash(bash:*),Bash(ls:*),Bash(grep:*),Bash(sed:*)" ...

需要读活体 state 时加 `--add-dir /home/lykoi/state`（但注意文件多为 0600，仍读不到内容）。

### Kevin 定的用模规矩

- **plan / 分析 / 审查 → `opus[1m]`**
- **动手实现 → `sonnet`**
- **opus 的 effort = medium**（已固化在服务器 `~/.claude/settings.json`）
- 服务器默认模型是 **Haiku 4.5**，不显式指定就会用它——分析类任务用它质量明显不够。
