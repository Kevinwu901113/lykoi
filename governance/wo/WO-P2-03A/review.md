# WO-P2-03A 复核报告（主治理 Agent）· 2026-08-09

**结论：代码通过，建议合并；但上线前必须补 §3 的活体验证四条（S4a 上线门）。**

- 分支 `wo/p2-03a`，提交 `49cdd029`（8 文件 +699 行），独立 worktree `~/lykoi-work-broker`
- 交付物：`src/lykoi/broker/`（app/tickets/config/audit/__main__）、`tests/test_broker.py`、
  `lykoi-broker.service` 草稿

## 一、独立验证

| 检查 | 结果 |
|---|---|
| broker 专项测试（我自跑） | **10 passed** ✓ |
| 六目录零改动（并行 lane 的前提） | `git status` 过滤六目录+guardian = **0 项** ✓ |
| manifest 未受影响 | 未改动 ✓ |
| p0 完整性 | 20 passed / 1 failed / 4 skipped——失败项为 claude 身份读不到 0600 活体文件的伪影（教训 27），非本单引入 ✓ |

## 二、流程问题（已记教训 23）

执行 Agent **两次在"等全量 pytest 跑完"处直接结束会话**，代码写完却没提交，报告只有一句
"我在等"。最终由复核方（我）在验证测试与隔离性后**代为提交**，提交信息中已注明作者分离。
教训已写入 HANDOFF #23：工单里不能有"等待"步骤。

## 三、上线前必补（S4a 达成门，设计 v1 §4.3）

代码层通过 ≠ S4a 达成。上线前须以子代理身份实测四条：
1. `/proc/<pid>/environ` 读不到任何真实 key；
2. 直连 api.deepseek.com 被网络白名单拒绝；
3. 经 handle 反代调用成功且审计有记录；
4. 合同过期后票据失效。

四条全过才算"子代理从第一天起拿不到明文密钥"成立。**当前仅完成代码与单测层面。**

## 四、部署注意

- broker 需独立 Unix 用户 `lykoi-broker`（设计 v1 §4.2）与 secrets 读权限配置——**需 Kevin 以 root 执行**。
- `lykoi-broker.service` 目前是草稿（User 占位），未安装。
- 票据为内存存储，重启即失效（已知取舍，报告中有记录）。
