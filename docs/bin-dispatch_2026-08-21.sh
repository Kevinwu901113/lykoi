#!/bin/bash
# usage: bin-dispatch.sh <WO-ID> <workdir> [model]   model 默认 sonnet, 复杂任务用 opus
# 必须以 setsid nohup 启动, 否则 ssh 会话结束时整个进程组被 SIGHUP 杀掉(2026-08-10 教训)
# 2026-08-21 修订: ① --add-dir ~/wo/$WO —— 工单参考材料执行方可读(WO-CA-BASELINE-1 材料缺失教训);
#                  ② 撞 session limit 立即停, 不再盲目重试烧额度(WO-GW-01 五连败教训, 8-11 即有候选)
WO=$1; WD=$2; MODEL=${3:-sonnet}
trap "" HUP
export http_proxy=http://192.168.0.202:7890 https_proxy=http://192.168.0.202:7890 HTTP_PROXY=http://192.168.0.202:7890 HTTPS_PROXY=http://192.168.0.202:7890
[ -f ~/.claude-oauth.env ] && . ~/.claude-oauth.env
echo "START wo=$WO wd=$WD model=$MODEL pid=$$ at=$(date -Is)" >> ~/wo/$WO/run.log
for i in 1 2 3 4 5; do
  echo "attempt=$i begin at=$(date -Is)" >> ~/wo/$WO/run.log
  cd $WD && $HOME/.local/bin/claude -p --model "$MODEL" --permission-mode acceptEdits \
    --add-dir ~/wo/$WO \
    --allowedTools "Read,Glob,Grep,Edit,Write,Bash(timeout:*),Bash(git:*),Bash(bash:*),Bash(python3:*),Bash(ls:*),Bash(grep:*),Bash(sed:*),Bash(find:*),Bash(mkdir:*),Bash(sqlite3:*),Bash(curl:*),Bash(.venv/bin/python:*),Bash(.venv/bin/pytest:*)" \
    < ~/wo/$WO/order.md > ~/wo/$WO/report.attempt$i.md 2>> ~/wo/$WO/run.log
  RC=$?
  cp ~/wo/$WO/report.attempt$i.md ~/wo/$WO/report.md
  git -C $WD add -A >/dev/null 2>&1; git -C $WD diff --cached --quiet 2>/dev/null || git -C $WD commit -q -m "[WIP] auto-saved after attempt $i" >/dev/null 2>&1
  if [ $RC -eq 0 ] && ! grep -q "API Error" ~/wo/$WO/report.md; then echo "EXIT=0 attempt=$i model=$MODEL at=$(date -Is)" >> ~/wo/$WO/run.log; exit 0; fi
  if grep -qi "hit your session limit" ~/wo/$WO/report.md; then echo "EXIT=SESSION_LIMIT attempt=$i at=$(date -Is) reset_hint=$(grep -oi 'resets [^"]*' ~/wo/$WO/report.md | head -1)" >> ~/wo/$WO/run.log; exit 2; fi
  echo "retry attempt=$i rc=$RC model=$MODEL at=$(date -Is)" >> ~/wo/$WO/run.log; sleep 30
done
echo "EXIT=FAILED_ALL_RETRIES at=$(date -Is)" >> ~/wo/$WO/run.log
