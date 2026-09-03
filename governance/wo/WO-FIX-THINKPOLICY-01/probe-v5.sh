#!/usr/bin/env bash
# 探针 v5（WO-FIX-THINKPOLICY-01 D-1）：把「思考档位」与「前缀长度/缓存」两个时延来源拆开量。
# 形态 S0 = step 0 近似：system = 产线 persona 正文（root 读 lykoi_base.toml，零正文入库）+ 契约；user 一句短话；json_object。
# 形态 S0P = S0 + 30k 字合成填充 system（看长前缀首跑/次跑差 = 缓存效应）。
# 形态 S1 = step ≥ 1 文本帧工具步（v4 的 MSGS 形态）。
# 档位：high = thinking enabled + reasoning_effort high（产线隐式现状）；low = enabled + low；off = thinking disabled。
# 每组各跑两次，打印 time_total / reasoning_len / content_len / 信封是否合法 / usage。只打印前 160 字。
set -u
set -a; . /home/lykoi/secrets/llm.env; set +a
BASE="${DEEPSEEK_BASE_URL:-https://api.deepseek.com}"
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
WORK=$(mktemp -d /tmp/probe-v5.XXXXXX); trap 'rm -rf "$WORK"' EXIT
python3 - "$WORK" "$PERSONA" <<'PY'
import json, sys, os
work, persona_path = sys.argv[1], sys.argv[2]
persona = open(persona_path, encoding='utf-8').read()
contract = ('现在只输出一个 JSON 对象，形如 {"decision":{"kind":"reply","content":"...","reason":"..."}} 或 '
            '{"decision":{"kind":"tool_call","tool":{"name":"research_read_text","arguments":{"url":"..."}}}} '
            '或 {"decision":{"kind":"silence","reason":"..."}}。以 { 开始、以 } 结束，不要代码块，不要任何别的字。')
pad = ('这是一段与任务无关的背景资料，用于测量长前缀的时延与缓存效应。' * 12 + '\n') * 60  # ≈ 30k 字
S0 = [{"role":"system","content":persona},
      {"role":"user","content":"帮我看看今天东莞天气怎么样"},
      {"role":"system","content":contract}]
S0P = [{"role":"system","content":persona},{"role":"system","content":pad},
       {"role":"user","content":"帮我看看今天东莞天气怎么样"},
       {"role":"system","content":contract}]
S1 = [{"role":"system","content":"你是 Lykoi 实例角色，用中文，简短。"},
      {"role":"user","content":"帮我看看今天东莞天气怎么样"},
      {"role":"assistant","content":json.dumps({"decision":{"kind":"tool_call","tool":{"name":"research_read_text","arguments":{"url":"https://wttr.in/Dongguan?format=3"}}}}, ensure_ascii=False)},
      {"role":"user","content":"[工具结果 research_read_text] {\"success\":true,\"data\":{\"text\":\"Dongguan: 🌦 +31°C\"},\"error\":null}"},
      {"role":"system","content":contract}]
levels = {
  "high": {"thinking":{"type":"enabled"},"reasoning_effort":"high"},
  "low":  {"thinking":{"type":"enabled"},"reasoning_effort":"low"},
  "off":  {"thinking":{"type":"disabled"}},
}
plan = [("S0",S0,["high","low","off"]),("S0P",S0P,["high","low"]),("S1",S1,["low","off"])]
for shape, msgs, lv in plan:
    for l in lv:
        body = {"model":"deepseek-v4-flash","stream":False,"response_format":{"type":"json_object"},"messages":msgs, **levels[l]}
        open(os.path.join(work, f"{shape}-{l}.json"),"w",encoding="utf-8").write(json.dumps(body, ensure_ascii=False))
print("persona_chars", len(persona), "pad_chars", len(pad))
PY
parse() { python3 -c '
import sys,json
t=sys.argv[1]; raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception as e: print("  time", t, "s  (响应非 JSON)", repr(raw[:160])); sys.exit()
if "error" in d and not d.get("choices"): print("  time", t, "s  API error:", str(d["error"])[:200]); sys.exit()
c=d["choices"][0]["message"]; content=c.get("content") or ""; r=c.get("reasoning_content") or ""
ok="?"
try:
    j=json.loads(content); ok="ok:"+str(j.get("decision",{}).get("kind"))
except Exception: ok="INVALID first_char=%r" % (content[:1],)
u=d.get("usage",{})
print("  time", t, "s  reasoning_len", len(r), " content_len", len(content), " envelope", ok, " prompt_tok", u.get("prompt_tokens"), " cache_hit", u.get("prompt_cache_hit_tokens"), " completion_tok", u.get("completion_tokens"), " finish", d["choices"][0].get("finish_reason"))
print("  content:", repr(content[:160]))
' "$@"; }
run() { f="$WORK/$1.json"; echo "=== $1"; for i in 1 2; do
  out=$(curl -sS -m 180 -o "$WORK/resp" -w '%{time_total}' "$BASE/chat/completions" -H "Authorization: Bearer $DEEPSEEK_API_KEY" -H "Content-Type: application/json" --data-binary "@$f")
  parse "$out" < "$WORK/resp"; done; }
for k in S0-high S0-low S0-off S0P-high S0P-low S1-low S1-off; do run "$k"; done
echo "=== 完（临时目录已清）"
