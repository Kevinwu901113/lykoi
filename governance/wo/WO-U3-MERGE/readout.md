# 证据门读数命令(root 一条,随时可跑;正式判读以攒够样本后为准)

窗口自合并重启(2026-08-18T16:17:32Z)起。七条判据对照 `docs/
mind_speech_unification_design_2026-08-12.md` D4 修订段。

```bash
sudo python3 - <<'EOF'
import json, statistics
W0 = "2026-08-18T16:17:32"
env, fails, llm, refresh = [], [], {}, 0
for line in open("/home/lykoi/state/events.jsonl"):
    try: e = json.loads(line)
    except Exception: continue
    if str(e.get("ts","")) < W0: continue
    ev = e.get("event")
    if ev == "u3_shadow_envelope": env.append(e)
    elif ev == "u3_shadow_failed": fails.append(e)
    elif ev == "stable_prefix_rebuilt": refresh += 1
    elif ev == "llm_call":
        r = llm.setdefault(e.get("route"), [0,0,0,0,0])
        r[0]+=1
        for i,k in enumerate(("prompt_tokens","completion_tokens","cache_hit_tokens","cache_miss_tokens"),1):
            r[i]+=e.get(k) or 0
freasons = {}
for f in fails:
    k = f"{f.get('reason','?')}/{f.get('detail','?')}"
    freasons[k] = freasons.get(k,0)+1
nt = [x for x in env if not x.get("tool_turn")]
lat = sorted(x.get("elapsed_ms") or 0 for x in nt)
kinds = {}
for x in env: kinds[x.get("kind")] = kinds.get(x.get("kind"),0)+1
unbacked = sum(1 for x in env if (x.get("receipt_backing") or {}).get("unbacked_claim"))
demoted = sum(1 for x in env if x.get("demoted"))
print(f"① 样本: 总 {len(env)} / 非工具 {len(nt)}   (门: ≥20 / ≥10)")
print(f"② 时延: 非工具中位 {statistics.median(lat) if lat else float('nan'):.0f}ms  (门: <15000)")
print(f"③ 失败: u3_shadow_failed={len(fails)} demoted={demoted}  (门: 零系统性)")
for k,v in sorted(freasons.items(), key=lambda x:-x[1]): print(f"    {k}: {v}")
print(f"④ 背书: unbacked_claim={unbacked}  (门: 0)   has_claim={sum(1 for x in env if (x.get('receipt_backing') or {}).get('has_action_claim'))}")
print(f"⑤ 夜穿: stable_prefix_rebuilt={refresh}(≤1/天)   kind 分布={kinds}")
for route,(c,p,co,h,m) in sorted(llm.items()):
    rate = f"{h/(h+m)*100:.0f}%" if h+m else "n/a"
    print(f"⑥ usage {route}: calls={c} 命中率={rate} completion/次={co/c if c else 0:.0f}  (门: main ≥70%)")
print("⑦ 对比抽查+体感: 人工项(delta_chars/head80_equal 分布见影子事件,Kevin 语气体感)")
EOF
```
