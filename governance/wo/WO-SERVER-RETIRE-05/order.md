# WO-SERVER-RETIRE-05 — 清空旧 Lykoi 服务器部署

状态：待具有该服务器 SSH/root 权限的本机执行方执行。当前云端会话没有服务器通道，未做任何停服、删除、备份、凭据撤销或部署动作。

## 所有者授权与目标

所有者于 2026-10-02 要求：“服务器旧有部署这些都清空吧。我们等于新生了。”此前已明确选择整体退役旧个人 Agent 运行时，代码仓库仅维护 Composer，main@1725452c13f9b48a3df5b3c1b1dcb70dcd5283b4。

目标：服务器不再运行、自动启动或恢复旧 Lykoi；旧代码、旧专属部署配置与旧运行状态退出部署，新版未来从空实例开始，不继承旧人格、记忆、任务或审批状态。本单不部署 Composer，不删除服务器上的其他项目或公共基础设施。

## 先核实当前服务器

历史连接是本机 SSH 别名 `lykoi-gov`，治理账户权限有限；破坏性停服/删除由所有者 root 或其授权执行方操作。别名与机器身份必须由本机现有配置和实时连接确认，不把历史主机信息当成当前连接依据，不在聊天中传密码、私钥或验证码。

先运行同目录只读 `inventory.sh`。它只记录 Lykoi 候选 unit、路径、所有权、大小等元数据，不读取凭据、数据库正文、进程参数或服务日志。其输出不是删除授权来源；授权来自上述所有者指令。现场还有新路径时补入实际清单，未归属 Lykoi 的对象保留。

## 清理对象与顺序

1. **关闭复活路径**：先停用并停止旧 Lykoi watchdog、定时器、cron/用户定时任务、自动部署或重启钩子。历史候选 `lykoi-cordis-watchdog.timer`、`lykoi-cordis-watchdog.service`；旧 Python 时代残留也需核实。
2. **停止旧服务**：停止实际存在的旧 Cordis 主服务、浏览器宿主、旧 core/broker/runner 等 Lykoi 专属 unit。历史候选 `lykoi-cordis.service`、`lykoi-browser.service`。按 unit 定位残留进程，不使用 `pkill node` 或按整个账号无差别杀进程。
3. **删除部署文件**：删除已核实的上述 unit 文件与专属 drop-in、watchdog 脚本、旧 Lykoi 专用代理/反向代理路由、专用 sudoers/控制器和配置。删除只针对清单里的精确路径；保留共享 SSH、Node、Chrome、代理、系统数据库及其他项目规则。使用 daemon-reload，并验证 unit 不再注册/启用。
4. **清空旧项目和实例**：核实后删除旧 Lykoi 检出、node_modules、构建产物、socket、进程锁、旧状态数据库、人格/记忆/任务/审批/心跳数据、浏览器专属 profile 和实例 registry。处理专属旧备份、封存部署和自动恢复脚本，避免随后恢复旧实例。不得把整个 `/home/lykoi` 视为一个可删除对象，它曾包含开发工具与其他资料。
5. **清理旧凭据和访问**：仅处理确认属于退役部署的凭据文件、Bot/webhook 与专属访问项；不打印、读取或提交凭据内容，不把 secrets 目录打包进仓库。关联凭据若还被其他应用使用，不全局撤销；记录归属并保留共享项。删除专属凭据文件不等于上游服务已撤销 token，分别记录实际结果。
6. **旧角色账户**：仅当已核实账号/组、目录及权限全部专属旧 Lykoi且无其他消费者时清理；否则保留账号，移除其旧 Lykoi 启动和特权入口即可。

历史候选路径（均须现场核实，不是可直接复制执行的 rm 列表）：

- `/home/lykoi/projects/lykoi`、`/home/lykoi/projects/lykoi-cordis`
- `/home/lykoi/state`、旧 instance registry、工作区和旧备份/封存区
- `/home/lykoi/runtime` 下的旧 Lykoi 控制配置
- `/home/lykoi-browser/profile`、`/etc/lykoi-browser`
- `/home/lykoi/secrets/telegram-cordis.env`、`/home/lykoi/secrets/llm.env`（只核实元数据，不读取内容）
- `/usr/local/sbin/lykoi-cordis-watchdog.sh` 及已核实的旧 Lykoi 专用控制器
- `/etc/systemd/system/` 下实际核实的 Lykoi unit 与 drop-in

所有历史代码和部署模板仍可从 Git 基线 `01afb64f3859ef46cd0e9a903ef3c085f3e56c2a` 查阅。它只保留代码历史，不承诺恢复被清空的服务器真实状态。

## 完成验收与报告

- 已核实的旧 unit 均不 active、不 enabled，不再注册；定时器/cron/自动部署钩子不能拉起它们。
- 旧服务进程、旧监听端口和 socket 消失，等待至少覆盖旧 watchdog 的一个周期（历史为 5 分钟）后仍不复活。
- 精确删除清单里的代码、状态、profile、部署配置和专属凭据文件不存在；共享例外明确列出，不能笼统宣称“服务器全空”。
- SSH 和其他项目/公共服务仍正常；未部署新版，未来实例从新状态根目录开始。
- report.md 记录真实机器身份的非敏感标识、执行时间、实际 unit/路径、结果与剩余项。没有执行的动作写“未执行”，不填假回执，不上传凭据或状态内容。
