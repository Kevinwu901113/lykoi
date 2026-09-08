# PROBE-CAP-02 · C2 实验准备

状态：工具准备已实现，实测未执行；基线 ca5bbac，分支 wo/probe-cap-02。evaluation / non-normative。未触及运行时 manifest 域。

- runner.py：从 C1 的 AST 字面量读取原三目标，创建3个G0目录；验证12个G1信封后创建12个G2目录；输入SHA、交付物/transcript、五项评分齐套才计算配对tax，拒覆盖已有试次。
- probe-cap-02.py：沿 C1 契约生成12条明确delegate请求；固定low，HTTPS且不跟随重定向；240秒超时；每条独立落盘、重启跳过已有结果，失败重试须显式参数。请求中的persona只在内存，不保存请求体；输出目录权限受077 umask保护。模型输出仍须人工审查再分享，不能承诺模型不会复述输入。
- rubric.md：G0/G2隔离、证据与人工评分协议。目录隔离不是模型上下文隔离，不宣称实现Task Runtime。

本地验证：离线两项测试通过（缺失/输入篡改拒算、完整合成样本的tax公式、非法G1不建部分G2）；采集器合成persona dry-run生成12请求计划，零API调用。合成评分只在临时测试目录，不能引用为真实实验读数。生产代码未改，不重复全仓回归。

## Kevin 执行 G1

在服务器 lykoi 账号执行，输出目录不要放仓库中：

```bash
set -a
. /home/lykoi/secrets/llm.env
set +a
python3 governance/wo/PROBE-CAP-02/probe-cap-02.py \
  --persona /home/lykoi/runtime/persona/lykoi_base.toml \
  --output /tmp/lykoi-c2-g1
```

正常输出12个试次状态。失败时保留记录，核原因后才加 `--retry-failed`；配置变化用新目录，不与旧样本混算。人工检查输出不含persona/凭证再交g1.json；本会话没有代连服务器或读取上述文件。

## 本地后续

```bash
python3 governance/wo/PROBE-CAP-02/runner.py prepare /tmp/lykoi-c2-trials
python3 governance/wo/PROBE-CAP-02/runner.py import-g1 /tmp/lykoi-c2-trials --g1 /tmp/lykoi-c2-g1/g1.json
python3 governance/wo/PROBE-CAP-02/runner.py score /tmp/lykoi-c2-trials
```

prepare后先执行3个独立G0；G1读数到位才执行G2。真实G0交付、12条G1、12条G2和独立评分尚缺；tax、persona差、相关方向与37.8建议均待测。缺失实测不会被“脚本完成”覆盖。
