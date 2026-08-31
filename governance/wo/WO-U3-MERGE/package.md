# 合并包 12 · WO-U3 周期合一(影子形态) · 2026-08-18

- 分支 `wo/u3` 尖 **`a923c44e`**,基 `2b8c477f` = 当前活体 HEAD → **可 ff**。
- 复核 PASS(`wo/WO-U3/review.md`);裁决项 2 条含在本包(A0 步 + S3 追认)。
- **本包落地后:影子双跑立即生效(默认开)。切换开关保持关——本包绝不设置
  `LYKOOI_U3_SWITCH_ENABLED`(拼写故意错,防复制粘贴手滑;真键名见 E 步说明)。**
- 单元文件零改动,**无需 daemon-reload**;EnvironmentFile 清单不变。

## A0 · 裁决项②:读盲格(root)

```bash
sudo python3 -c "import json; r=json.load(open('/home/lykoi/state/approval_rules.json')); print([e for e in r.get('always_allow',[]) if 'messenger' in e])"
```

把输出原样记给治理侧:裸 `messenger.send` → 切换单议收窄;scoped(`@user:` 形态)
→ 记录即可。

## A · 取分支(claude 已备 bundle)

```bash
sudo -u claude sha256sum /tmp/lykoi-merge-u3-20260818.bundle
# 应 = 4aa9eddcd546fa46bdb55a33a411ef089b71a98d789b58159f3acd48b435c191
# (thin bundle 基 2b8c477f,bundle verify 已过)
cd /home/lykoi/projects/lykoi
sudo -u lykoi git fetch /tmp/lykoi-merge-u3-20260818.bundle wo/u3
sudo -u lykoi git merge --ff-only a923c44e
```

## B · 属主与封存边界(root;含模板修正:nothing-to-commit 不断链)

```bash
cd /home/lykoi/projects/lykoi
git diff --name-only 2b8c477f..a923c44e | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi
# 封存边界:kernel 触及 5 文件(policy_exemption.py 新增)须 root 属主 644
chown root:root src/lykoi/kernel/policy_exemption.py src/lykoi/kernel/approval.py src/lykoi/kernel/dispatch.py src/lykoi/kernel/approval_conversation.py src/lykoi/kernel/suggestion_conversation.py
chmod 644 src/lykoi/kernel/policy_exemption.py
chown root:root guardian/manifest.sha256
find src -name __pycache__ -type d -exec rm -rf {} +
chown -R lykoi:lykoi /home/lykoi/projects/lykoi/.git
```

manifest 已在分支重签(108→110);root 侧核验:

```bash
cd /home/lykoi/projects/lykoi && sudo -u lykoi .venv/bin/python -m lykoi.guardian_tools.verify_manifest 2>/dev/null || .venv/bin/python guardian/startup_verify.py --check-only
```

(以现有核验入口为准;`FAIL` 即停,喊治理侧。)

## C · 测试(lykoi 身份,前台串行)

```bash
cd /home/lykoi/projects/lykoi && sudo -u lykoi bash -c 'timeout 1800 .venv/bin/pytest -q tests/test_u3_conversation_cycle.py tests/test_u3_policy_exemption.py tests/test_u3_shadow_zero_disturbance.py tests/test_p2_s3_approval_wiring.py tests/test_p0_integrity.py tests/test_telegram_device.py tests/test_messenger.py'
```

预期全绿(lykoi 身份无 0600 假失败)。

## D · 重启与门

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
journalctl -u lykoi-server -n 5 --no-pager | grep startup_verify
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
curl -s 127.0.0.1:8080/health | head -c 200
```

`startup_verify: OK` + 五 active + health ok = 门过。

## E · 落地即观察(影子期,证据门制)

- 影子自动生效(`LYKOI_U3_SHADOW_ENABLED` 默认开,无需设置);
- **切换键 `LYKOI_U3_SWITCH_ENABLED` 本包不碰、默认关**;
- Kevin:跟她正常聊天(每轮喂一个影子样本)+ 语气体感;
- 证据门七条(D4 修订版,正本 mind_speech 设计文档):样本 ≥20(非工具 ≥10)、
  非工具中位 <15s、零系统性信封失败、P2 零无据陈述、穿越 ≥1 nightly、
  main ≥70%、对比抽查+体感。读数命令治理侧到时给(root 一条);
- 达门 → Kevin 批 → 切换单(另发)。

## 回滚

影子出问题:`LYKOI_U3_SHADOW_ENABLED=0` 进对应 drop-in 重启即停,无需回代码。

## 落地记录(2026-08-19 00:17)

- **一起治理事故(落地过程中发现并处置)**:23:13 一个 Claude Code remote 桥接
  进程以 lykoi 身份上线(`~lykoi/.claude/remote/...server --bridge`,Kevin IP),
  23:14:34 把 U3 非 kernel 文件直接拷进活体检出(绕过合并协议,在 root-only
  的 kernel 处折断,留半套)。**她全程清白**(audit 干净:当时在读甲子园新闻,
  terminal.exec 仅两次 `date` 且均被门拦)。处置:kill 桥接进程 → 残留隔离
  `/tmp/u3-residue-20260818/`(内容经核与分支逐字节一致)→ 树净 → root 合并。
  **残留半套期间活体是重启炸弹**(telegram_device import 缺失模块 + manifest
  哈希不符,任何重启会被启动门拒启)——所幸窗口期内无重启。
- 第二败:lykoi 身份 ff-merge 在封存路径(guardian/manifest + kernel ×5)
  Permission denied——**教训④升级:触及 kernel/ 的合并与 guardian 同类,
  A 步必须 root 执行**(本包 A 步原写 `sudo -u lykoi`,错)。
- 最终:root 清残留 + root ff-merge `2b8c477f → a923c44e` 成功(16 文件
  +1968/−69 与分支逐位一致)→ B 步属主归位 → D 步门过(startup_verify OK,
  五 active,health ok,00:17:32)。**影子自此在活体上活着。**
- **C 步(补跑,治理侧以 lykoi 身份执行,Kevin 授权"跑一下")**:七套件
  **173 passed / 0 failed**(4:06)——lykoi 身份下 p0 完整通过,零假失败。
  包账全闭。
- A0 盲格:`messenger.send@user:user_001`(scoped),切换单无需收窄。
- 模板债两条(下包修):①B 步首段管道吞 `git diff` 错误码(本次曾把"没
  合并"藏过去);②A 步执行身份按封存触及面写死 root。
