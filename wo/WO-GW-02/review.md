# WO-GW-02 复核 · Delegation Gateway 执行面(T1 Runner + broker)

- 复核人：治理 Agent（主窗口）
- 复核日期：2026-08-22 晨
- 级别：必要检测级
- 执行情况：第 1 波规范停工（裁决 A）+ 第 2 波单次 EXIT=0 全交付（3h23m）
- **结论：PASS（追认项 2 条 + 转呈 5 项，见 §4/§5）**

## 1. 合规核

- 尖 `076634f9`，基 `32238013`，7 commit 每判据一个，工作树干净。
- **足迹独立核查**：23 文件 = runner/ 七件（新）+ broker/ 四件 + 部署三件
  （lykoi-runner.service / provision 脚本 / 合并包清单）+ verify_s4a + handles
  样例 + 6 新测试 + test_broker（唯一既有测试改动=事件改名的必然修改，
  下游零消费已核）。
- **封存区零 diff 独立确认**：core/、kernel/、cognition/、mind/、resources/、
  guardian/、conftest、requirements.txt 全空——"Core 一个字节没动"与"不装不
  影响既有五服务"的物理面成立；manifest 不在改动集（112 不变主张一致）。
- forbidden 全项遵守；停工纪律→裁决→续跑的流程完整（第二次真实生效）。

## 2. 独立验证

- **套件复跑**（6 新套件 + test_broker + test_gw01_delegation）：
  **200 passed / 0 failed**（3m57s）——200 = 新增 129 + broker 既有 10 +
  GW-01 61，逐数闭合。
- manifest 112 条与基逐字节一致（git diff 不含 manifest + CB 复核侧 113 条
  重算里的 112 条共享基面，交叉印证）。
- 全量对账采信执行方 **2294/7/6**（collect 2307=2178+129 精确闭合；
  125+4=129 闭合式成立）。7 失败 = 1 条 p0 假失败（与 GW-01 逐字同）+ 6 条
  core_v1_shadow——执行方做了**三次对照实验**（同 chunk 同 HEAD 两跑 6→11、
  基线 worktree 11）证明浮动是跑间的且基线不少于尖端。**新增失败 0。**

## 3. 决审要点

- **两个实测出来的真 bug** 是本波亮点：①收据 kind 覆盖顺序反了（失败收据
  自称成功执行——37.8 回执背书的直接威胁，已修+回归）；②urllib 默认吃代理
  env 会把 127.0.0.1 取票送进代理箱（"真 socket 不用 TestClient"的选择让它
  在生产前暴露）。
- **fail-closed 纪律贯穿**：合同看不懂/取不到票/沙箱失败→rejected 挂收据；
  唯一例外=审计不可用时状态不迁移（审计先于事实,与 dispatch 同失败方向）。
- **`verified` 永不被 Runner 写**——9.4 单写者在委托域的正确落法；合同今天
  停在 `collected` 是设计 §5 步 4 的领地，已入遗留。
- **S4a 诚实拆分**：四门里三门仓内真测（①③④），门②唯一按假设交付且有
  专门用例钉住"是声明不是假绿"。
- **判据②降级执行到位**：7 条负例把 fail-open 静默吞钉成事实；静态守卫
  证明今天零 delegated 构造点；§7 交接节质量足以直接作未来
  WO-CORE-DELEGATED-VOCAB 的 order 底稿（含 7.6 步序与 7.5 判断题）。

## 4. 追认项（呈 Kevin）

1. **裁决 A 本身**（治理侧凌晨代决，据实呈报）：判据②解耦、七态映射
   collected/rejected、broker 三缺口范围、guardian sink 联写默认关、独立
   lykoi-runner 单元。执行结果证明裁决可行且零 Core diff。
2. **test_broker.py 一处断言改名**（grant→EVENT_GRANT）：裁决词表对齐的必然
   修改，性质不变，下游零消费者已核——建议追认。

## 5. 转呈 Kevin 的五项决断（原文 §10，治理侧意见附后）

1. broker 审计联写权限方案——**附议 C-a**（lykoi-audit 组 + 0620 + chattr +a）。
2. **代理箱 ACL 是 S4a 最后一块**：做不了则 lykoi-runner 不装——附议，且这
   决定 C-C 首器官的开工时点。
3. `src/lykoi/runner/` 纳入 manifest 覆盖面（需动 guardian，独立决定）——
   **附议纳入**，建议与 HARD_ASK 之后的下一次 guardian 变更同批。
4. `verified` 态零写者=步 4 领地——记档。
5. core_v1_shadow 失败数不再作回归基线成分——**附议**，测试隔离收敛单
   （GW-01 遗留③）升为下一批小单，CB-01 复核 §4.2 的 AttributeError 新知
   并入同单。

## 6. 部署面（合并包信息）

代码落地随总攻粘贴稿（零新 env 必需项、既有五单元零 diff、不装 runner/broker
即零行为变化）。系统安装（useradd/单元/ACL/handles 真值）**不在粘贴稿内**，
按 `docs/wo_gw02_merge_checklist.md` A–F 走，E2a=代理白名单实测，前提见 §5.2。
