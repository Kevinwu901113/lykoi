# salience 影子期放行门读数 · 2026-08-13

phase5 prereg v1 §4 的启动顺序:①文档落盘+签 manifest → ②prereg lock 审计 →
③影子写入开始 → **④ ≥14 天 + 吸收率 ≥5%** → ⑤放行门审计 → ⑥live。
本文只做第 ④ 步的读数与判定,不改任何代码、不动影子管线。

## 读数(活体,2026-08-13)

| 项 | 门槛 | 实测 | 判定 |
|---|---|---|---|
| 影子时长 | ≥14 天 | 起点 `2026-07-10T14:16:55Z`,**34 天** | ✅ 超标 2.4 倍 |
| 全局吸收率 | ≥5% | selected 721 / success 675 = **93.6%** | ✅ 超标 18 倍 |
| shadow_log 总行 | — | 1768(其中 selected 721) | — |

口径:吸收率 = `outcome='success'` ÷ `selected=1`。reward 锚按 prereg §4 =
仅 nightly integration 的 `accepted_op` 物理引用(`experiences.integrated=1`
且 `integration_id` 非空),由 sidecar 触发器写死一次,不可改写。

**结论:第 ④ 步的双条件早在数周前就已满足,流程停在这里没人推进。**

## 放行门审计时必须一并回答的一个问题(不是阻塞项,是判读问题)

93.6% 的吸收率意味着:**被影子选中的经验几乎总能被 nightly 吸收**。
两种解释对"是否放行"的含义完全相反:

1. **策略确实好** —— bandit 学到的选择规则与 integrator 的接受标准高度一致,
   放行即收益;
2. **reward 锚太松** —— integrator 接受得太宽(几乎什么都吸收),于是奖励信号
   近乎恒正,bandit 其实没有区分度,93.6% 只是在测量 integrator 的宽松度,
   不是在测量 salience 的判断力。

区分方法(读数即可,不需改代码):看**未被选中**的经验的吸收率作对照。
若 `selected=0` 的经验吸收率同样接近 90%,就是解释 2;若明显更低,是解释 1。
影子表只对 selected=1 的行清扫 outcome(源码 §343 有界幂等清扫),所以这个
对照数要从 memory.db 侧按 shadow_log 的 experience_id 反查:

```bash
sudo -u lykoi python3 - <<'PY'
import sqlite3
sh = sqlite3.connect("file:/home/lykoi/state/salience_shadow.db?mode=ro", uri=True)
mem = sqlite3.connect("file:/home/lykoi/state/memory.db?mode=ro", uri=True)
rows = sh.execute("SELECT experience_id, selected FROM shadow_log").fetchall()
sel = {e for e, s in rows if s == 1}
unsel = {e for e, s in rows if s != 1} - sel
def absorbed(ids):
    if not ids: return (0, 0)
    q = ",".join("?" * len(ids))
    n = mem.execute(f"SELECT COUNT(*) FROM experiences WHERE id IN ({q})", tuple(ids)).fetchone()[0]
    ok = mem.execute(
        f"SELECT COUNT(*) FROM experiences WHERE id IN ({q}) AND integrated=1 AND integration_id IS NOT NULL",
        tuple(ids)).fetchone()[0]
    return (ok, n)
for name, ids in (("selected", sel), ("not selected", unsel)):
    ok, n = absorbed(ids)
    print(f"{name}: {ok}/{n} = {100.0*ok/n:.1f}%" if n else f"{name}: 无样本")
PY
```

## 下一步(属既有流程,不新增路线)

- 若对照数支持解释 1:走第 ⑤ 步 Codex 放行门审计 → ⑥ live。
- 若支持解释 2:放行前先修 reward 锚的口径 —— 这属于 prereg §4 常数/口径改动,
  按纪律 = 出 v2 + 重签 + **影子计时清零重来**,代价是再等 14 天,因此值得在
  放行前就把这个数看清楚。
- 无论哪种:prereg §4 的"影子期内任何常数改动 = 计时清零"意味着**这段时间不要
  碰那张常数表**。
