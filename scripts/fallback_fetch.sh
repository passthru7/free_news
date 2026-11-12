#!/bin/bash
# 服务器兜底抓取：每2小时跑一次（GitHub Actions cron 生效后可停用）
set -e
cd /home/agentuser/deals-site
export PATH=/usr/local/bin:/usr/bin:/bin
# token 存在本地未跟踪文件 .github_token
TOKEN=$(cat .github_token 2>/dev/null)
LAST=$(curl -s --max-time 15 -H "Authorization: token $TOKEN" \
  "https://api.github.com/repos/passthru7/free_news/actions/workflows/fetch.yml/runs?per_page=1" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)["workflow_runs"]; print(r[0]["created_at"] if r else "")' 2>/dev/null || echo "")
if [ -n "$LAST" ]; then
  AGE=$(( $(date +%s) - $(date -d "$LAST" +%s) ))
  if [ "$AGE" -lt 10800 ]; then
    echo "$(date '+%F %T') GitHub 近期已抓取（$LAST），跳过"
    exit 0
  fi
fi
git pull --rebase origin main >/dev/null 2>&1 || true
node scripts/fetch_sources.mjs docs state
if git diff --quiet docs/data.json; then
  echo "$(date '+%F %T') 数据无变化"
else
  git add docs/data.json state/history.json
  git commit -m "chore: 服务器兜底抓取 $(date '+%m-%d %H:%M')"
  git push origin main
  echo "$(date '+%F %T') 已推送更新"
fi
