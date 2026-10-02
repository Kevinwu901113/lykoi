# WO-SERVER-RETIRE-05 清理报告

状态：已核实范围内的旧 Lykoi 部署及补充残留已清理并验证。共处理 120 个精确清单路径（85 个主清单路径、35 个补充路径，目录包含其子文件）。共享服务、开发工具和历史文档保留。

## 执行与证据

- 日期：2026-10-02；时区：Asia/Shanghai。
- 机器：SSH 现有别名 lapw1ng.com / lykoi-gov，远端 hostname=lykoi，Linux 6.8.0-138-generic。
- 依据：GitHub Kevinwu901113/lykoi 的 governance/wo/WO-SERVER-RETIRE-05/order.md，及所有者本会话授权。
- root 清理由所有者在其交互终端执行；Codex 通过本机 SSH 盘点、准备脚本及独立只读复核。未向 Codex 提供密码、私钥。
- 主执行：18:10:09 开始；18:13:27 续执行；18:18:43 主清单验收成功。
- 远端回执：/var/tmp/wo-server-retire-05-cleanup.i8RMhrwV。
- 本地证据：cleanup-execution.log；精确主清单：deletion-manifest.txt（85 个路径）。

## 已执行

删除 18 个旧 Lykoi systemd unit 文件及专属 browser drop-in；删除 watchdog/backup 脚本及 claude-governance 专属 sudoers。

删除旧 Cordis 检出、state、runtime、workspace、封存 old-body、quarantine、旧 staging；删除 browser profile/data/config、/etc/lykoi-browser、/opt/lykoi-pi、/opt/lykoi-browser；删除 9 个专属凭据文件及旧副本、33 个 Lykoi 专属 /var/lib 路径、7 个治理账户旧检出及 p5 发布目录。

专属凭据文件删除不代表上游 token 撤销：Bot/webhook、上游 API token 撤销未执行。

## 验证结果

- root 脚本确认 85 个路径不存在；18 个 unit LoadState=not-found、ActiveState=inactive。
- 观察 310 秒，超过现场 watchdog 5 分钟周期，未复活。
- sudoers 语法检查通过。
- 运行中的共享系统服务在前后比较中无停止项（排除会话型 user@ 服务）。
- Codex 随后独立 SSH 复核：无 Lykoi unit 文件注册；SSH active；TCP/UDP 监听仅见 SSH、系统 DNS/DHCP。
- 盘点所见 Claude remote server 和 socket 属开发工具，保留；未按账户杀进程。
- 未部署 Composer 或其他新版，旧实例状态根已删除。

## 中断与修复

1. 首次删除在封存 audit.jsonl 处遇到 Operation not permitted，立即中止。root 实测该文件有 append-only 属性 a；续执行仅解除该精确旧封存文件的 i/a 属性，随后删除。
2. 首版续执行误把 systemctl 零匹配返回 1 当作失败，在删除前中止。改为读取全部 unit 再筛选，并在远端验证后续执行。

## 保留项与范围限制

保留账号、SSH 配置、Node/Chrome 公共安装、Claude/Codex/VS Code 开发工具、公共系统服务、插件及历史治理 Markdown 文档。未删除 /home/lykoi 或 /home/claude 整个目录。对不明归属的个人文件不作删除。

补充清理：14 个旧状态备份、bundle、运维脚本和日志路径，以及治理工单区 21 个旧代码/恢复脚本路径，均已实际删除并逐项验证不存在。分别见 residual-lykoi-manifest.txt、residual-claude-manifest.txt；执行回执分别为 residual-lykoi-result.txt、residual-claude-result.txt。

补充删除曾被自动审批以备份与历史运维资料授权范围不明确为由拒绝。所有者随后对列明的 35 个路径明确回复“同意”，重新提交审批通过后执行；未绕过拒绝。

## 最终复核

2026-10-02 20:10:31（Asia/Shanghai，远端 UTC 12:10:31）再次通过本机 SSH 核实：

- 全部 systemd unit 文件及已加载 unit 中均无 Lykoi 项。
- SSH active；TCP/UDP 监听仅见 SSH 和系统 DNS/DHCP。
- Claude remote socket 仍存在，未删除开发工具或其运行入口。
- /home/lykoi/projects、secrets、logs 的直接子项清单为空。
- /home/claude/wo 中 .sh、.bundle、.tar.gz、.zip、.py、.js 残留匹配为零；历史工单和文档保留。
- 最终复核距主清理超过 1 小时；未出现旧服务复活。

没有清空整机，也未对所有个人文件、开发工具历史、系统 journal、外部/异机备份进行数据擦除。历史治理文档、报告、来源不明的个人文件、空账户目录及本次清理证据保留。未声称上游凭据已失效。

本报告及精确删除清单、脱离凭据与状态正文的执行回执归档于本工单目录。仓库记录与服务器清理为两项独立动作；本次提交不执行任何服务器部署。

## 报告入库验证

本次仅增加报告、清单与执行回执并同步工单状态，不修改产品代码。干净检出基于 ce9809b，Node.js v24.18.0；`npm ci` 成功、`npm run typecheck` 通过、`npm test` 31/31 通过。测试首次受沙箱本机监听 EPERM 限制，获批以相同命令在沙箱外执行后通过。`git diff --check` 通过。
