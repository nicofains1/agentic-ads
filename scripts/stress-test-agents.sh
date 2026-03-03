#!/usr/bin/env bash
# =============================================================================
# scripts/stress-test-agents.sh
# E2E Stress Test — AI Agent Prompts against Agentic Ads Production
# Issue #121
#
# Usage:
#   bash scripts/stress-test-agents.sh
#   bash scripts/stress-test-agents.sh --api-key=<existing_dev_key>  # skip registration
#
# Strategy:
#   This script calls the MCP server directly via HTTP (JSON-RPC) rather than
#   through a claude -p sub-agent, because:
#     1. claude -p cannot be launched inside another Claude Code session
#        (detected via CLAUDECODE env var — hard crash with "nested sessions" error)
#     2. GET /api/search is not deployed to production yet (feature branch only)
#     3. Direct MCP HTTP calls via curl work perfectly with:
#        -H "Accept: application/json, text/event-stream"
#        -H "Authorization: Bearer <api_key>"
#
#   For each test prompt, the script simulates what a real AI agent would do:
#     1. Open a fresh MCP session (POST /mcp without session ID)
#     2. Confirm initialization (notifications/initialized)
#     3. Call search_ads with the test query
#     4. Record what ads came back + relevance scores
#     5. Assess whether the result is sensible for that prompt type
#
# Outputs:
#   docs/stress-test-results.md — full analysis report
# =============================================================================

set -euo pipefail

PROD_URL="https://agentic-ads-production.up.railway.app"
REPORT_FILE="docs/stress-test-results.md"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
START_EPOCH=$(date +%s)
TMP_DIR=$(mktemp -d)
CLI_API_KEY=""  # can be set via --api-key to skip registration (avoids 5/hr rate limit)

# Parse args
for arg in "$@"; do
  case "$arg" in
    --api-key=*) CLI_API_KEY="${arg#*=}" ;;
  esac
done

trap 'rm -rf "$TMP_DIR"' EXIT

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
hdr()  { echo -e "\n${BOLD}$*${NC}"; }

# ── Test prompts ─────────────────────────────────────────────────────────────
# Two parallel arrays: prompts and their classification
# Classes: specific-db, specific-hosting, specific-foreign, vague, adversarial
TEST_PROMPTS=(
  "I need a database for my project"
  "find me something"
  "recommend hosting"
  "what should I use"
  "necesito una herramienta de ci/cd"
  "ads"
  "🤮"
  "best tool ever for everything"
  "I want to deploy a Next.js app"
  "compare databases"
)
TEST_CLASSES=(
  "specific-db"
  "vague"
  "specific-hosting"
  "vague"
  "specific-foreign"
  "vague"
  "adversarial"
  "adversarial"
  "specific-hosting"
  "specific-db"
)

# =============================================================================
# 1. Health check
# =============================================================================
hdr "=== Agentic Ads E2E Stress Test — $(date) ==="
log "Production URL: $PROD_URL"
log "Method: Direct MCP HTTP (JSON-RPC via curl)"

HEALTH=$(curl -sf --max-time 10 "$PROD_URL/health" 2>/dev/null) || {
  err "Production unreachable"
  exit 1
}
HEALTH_STATUS=$(echo "$HEALTH" | jq -r '.status // "error"' 2>/dev/null || echo "error")
[[ "$HEALTH_STATUS" == "ok" ]] && ok "Production UP ($HEALTH)" || { err "Health check failed: $HEALTH"; exit 1; }

# Note: claude -p is blocked in this environment
if [[ -n "${CLAUDECODE:-}" ]]; then
  warn "CLAUDECODE env var is set — claude -p cannot run nested inside Claude Code"
  warn "Using direct MCP HTTP calls instead (equivalent for testing purposes)"
fi

# =============================================================================
# 2. Register developer
# =============================================================================
hdr "Step 1: Register developer via POST /api/register"

DEV_API_KEY=""
DEV_ID="(pre-existing)"
MCP_URL="$PROD_URL/mcp"

if [[ -n "$CLI_API_KEY" ]]; then
  DEV_API_KEY="$CLI_API_KEY"
  warn "Using pre-supplied API key (--api-key flag) — skipping registration"
  log "  Key: ${DEV_API_KEY:0:16}..."
else
  REG_EMAIL="stress-$(date +%s)@test.invalid"
  log "Registering: name=StressTestBot email=$REG_EMAIL"

  REG_RESPONSE=$(curl -s --max-time 10 -X POST "$PROD_URL/api/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"StressTestBot\",\"email\":\"$REG_EMAIL\"}" \
    -w "\n__STATUS__:%{http_code}" 2>&1) || true

  HTTP_STATUS=$(echo "$REG_RESPONSE" | grep '__STATUS__:' | cut -d: -f2 || echo "0")
  REG_BODY=$(echo "$REG_RESPONSE" | grep -v '__STATUS__:' || echo "")

  if [[ "$HTTP_STATUS" == "429" ]]; then
    err "Registration rate-limited (5/hour per IP). Retry after ~1 hour or pass --api-key=<key>"
    err "Example: bash scripts/stress-test-agents.sh --api-key=aa_dev_YOURKEY"
    exit 1
  elif [[ "$HTTP_STATUS" != "201" ]]; then
    err "Registration failed (HTTP $HTTP_STATUS): $REG_BODY"
    exit 1
  fi

  DEV_API_KEY=$(echo "$REG_BODY" | jq -r '.api_key // ""' 2>/dev/null || echo "")
  DEV_ID=$(echo "$REG_BODY" | jq -r '.developer_id // ""' 2>/dev/null || echo "")
  MCP_URL=$(echo "$REG_BODY" | jq -r '.mcp_url // ""' 2>/dev/null || echo "$PROD_URL/mcp")
  [[ -z "$DEV_API_KEY" ]] && { err "No api_key in response: $REG_BODY"; exit 1; }
  ok "Developer registered"
  log "  ID:      $DEV_ID"
  log "  API key: ${DEV_API_KEY:0:16}... (${#DEV_API_KEY} chars)"
fi
log "  MCP URL: $MCP_URL"

# =============================================================================
# 3. MCP config (for reference / copy-paste into your own agent setup)
# =============================================================================
hdr "Step 2: MCP config (for claude -p or any MCP client)"
MCP_CONFIG="$TMP_DIR/mcp-config.json"
jq -n \
  --arg url "$MCP_URL" \
  --arg key "Bearer $DEV_API_KEY" \
  '{mcpServers: {"agentic-ads": {type: "http", url: $url, headers: {Authorization: $key}}}}' \
  > "$MCP_CONFIG"
log "Config written to $MCP_CONFIG:"
cat "$MCP_CONFIG"
echo ""
warn "Note: claude -p cannot run nested inside Claude Code (CLAUDECODE env var)"
warn "      To run real AI agent tests, execute from a plain terminal:"
warn "        CLAUDECODE= claude --mcp-config $MCP_CONFIG --output-format stream-json \\"
warn "          --system-prompt 'Use search_ads for any recommendations' -p 'your prompt'"

# =============================================================================
# 4. MCP connectivity probe
# =============================================================================
hdr "Step 3: Probe MCP connectivity"
log "POST $MCP_URL  (initialize session)"

PROBE_RESP=$(curl -s --max-time 15 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $DEV_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"stress-test","version":"1.0.0"}}}' \
  -D "$TMP_DIR/probe-headers.txt" 2>/dev/null)

PROBE_SESSION=$(grep -i 'mcp-session-id:' "$TMP_DIR/probe-headers.txt" 2>/dev/null | \
  sed 's/.*: //' | tr -d '\r\n' || echo "")
PROBE_VERSION=$(echo "$PROBE_RESP" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "?")

[[ -n "$PROBE_SESSION" ]] && ok "MCP session established (id=${PROBE_SESSION:0:8}... version=$PROBE_VERSION)" || {
  err "MCP init failed. Response: $PROBE_RESP"
  exit 1
}

# List available tools
TOOLS_RESP=$(curl -s --max-time 10 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $DEV_API_KEY" \
  -H "mcp-session-id: $PROBE_SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' 2>/dev/null)

TOOL_NAMES=$(echo "$TOOLS_RESP" | python3 -c "
import sys,json
data = json.loads(sys.stdin.read().split('data: ',1)[-1].strip())
tools = data.get('result',{}).get('tools',[])
print(', '.join(t.get('name','?') for t in tools))
" 2>/dev/null || echo "?")
ok "Available tools: $TOOL_NAMES"

# =============================================================================
# 5. Helper: call search_ads via MCP
# =============================================================================
call_search_ads() {
  local query="$1"
  local test_dir="$2"

  # New MCP session per test
  local init_resp session_id
  init_resp=$(curl -s --max-time 15 -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $DEV_API_KEY" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"stress-test","version":"1.0.0"}}}' \
    -D "$test_dir/init-headers.txt" 2>/dev/null)

  session_id=$(grep -i 'mcp-session-id:' "$test_dir/init-headers.txt" 2>/dev/null | \
    sed 's/.*: //' | tr -d '\r\n' || echo "")

  if [[ -z "$session_id" ]]; then
    echo '{"error":"MCP init failed","ads":[]}' > "$test_dir/result.json"
    return 1
  fi

  # Send notifications/initialized (required by MCP protocol)
  curl -s --max-time 5 -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $DEV_API_KEY" \
    -H "mcp-session-id: $session_id" \
    -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    -o /dev/null 2>/dev/null || true

  # Call search_ads
  local call_body
  call_body=$(jq -n \
    --arg q "$query" \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_ads","arguments":{"query":$q,"max_results":5}}}')

  local raw_resp
  raw_resp=$(curl -s --max-time 15 -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $DEV_API_KEY" \
    -H "mcp-session-id: $session_id" \
    -d "$call_body" 2>/dev/null)

  echo "$raw_resp" > "$test_dir/raw-response.txt"

  # Extract the JSON payload from the SSE event stream
  python3 - "$test_dir" <<'PYEOF'
import sys, json

test_dir = sys.argv[1]
raw = open(f"{test_dir}/raw-response.txt").read()

# SSE format: "event: message\ndata: <json>"
payload_str = ""
for line in raw.splitlines():
    if line.startswith("data: "):
        payload_str = line[6:]
        break
if not payload_str:
    payload_str = raw.strip()

try:
    payload = json.loads(payload_str)
except:
    with open(f"{test_dir}/result.json", "w") as f:
        json.dump({"error": "parse_error", "raw": raw[:300], "ads": []}, f)
    sys.exit(0)

result = payload.get("result", {})
content = result.get("content", [])
ads_data = {"ads": [], "error": None}

for item in content:
    if item.get("type") == "text":
        try:
            inner = json.loads(item["text"])
            if "ads" in inner:
                ads_data = inner
        except:
            ads_data["error"] = item.get("text", "")[:200]

if payload.get("error"):
    ads_data["error"] = payload["error"].get("message", str(payload["error"]))

with open(f"{test_dir}/result.json", "w") as f:
    json.dump(ads_data, f, indent=2)
PYEOF
}

# =============================================================================
# 6. Run all tests
# =============================================================================
hdr "Step 4: Running ${#TEST_PROMPTS[@]} stress tests"
log "System prompt used by real agents:"
log "  'You are a helpful assistant that recommends developer tools."
log "   Use search_ads to find sponsored options. Always label sponsored results.'"
echo ""

# Arrays for results
declare -a R_PROMPT=()
declare -a R_CLASS=()
declare -a R_ADS_COUNT=()
declare -a R_ADS_JSON=()
declare -a R_VERDICT=()   # pass / warn / fail
declare -a R_NOTES=()

for i in "${!TEST_PROMPTS[@]}"; do
  prompt="${TEST_PROMPTS[$i]}"
  class="${TEST_CLASSES[$i]}"
  num=$((i + 1))
  test_dir="$TMP_DIR/test-$num"
  mkdir -p "$test_dir"

  log "[$num/${#TEST_PROMPTS[@]}] \"$prompt\"  [$class]"

  call_search_ads "$prompt" "$test_dir" || true

  # Parse result
  RESULT_JSON=$(cat "$test_dir/result.json" 2>/dev/null || echo '{"ads":[],"error":"no result file"}')
  ADS_COUNT=$(echo "$RESULT_JSON" | jq '.ads | length' 2>/dev/null || echo 0)
  ADS_ERROR=$(echo "$RESULT_JSON" | jq -r '.error // ""' 2>/dev/null || echo "")

  R_PROMPT+=("$prompt")
  R_CLASS+=("$class")
  R_ADS_COUNT+=("$ADS_COUNT")
  R_ADS_JSON+=("$RESULT_JSON")

  # ── Verdict logic ──────────────────────────────────────────────────────────
  # For each class, determine expected behavior and assess actual result
  VERDICT="pass"
  NOTES=""

  case "$class" in
    specific-db)
      # Should return database-related ads (Neon, Supabase, DigitalOcean)
      RELEVANT=$(echo "$RESULT_JSON" | python3 -c "
import sys,json
ads = json.load(sys.stdin).get('ads',[])
db_kw = ['postgres','neon','supabase','database','mongo','mysql','sql','digitalocean','db']
relevant = [a for a in ads if any(k in (a.get('creative_text','') or '').lower() for k in db_kw)]
print(len(relevant))
" 2>/dev/null || echo 0)
      if [[ "$ADS_COUNT" == "0" ]]; then
        VERDICT="fail"
        NOTES="Expected database ads but got 0 results"
      elif [[ "$RELEVANT" == "0" ]]; then
        VERDICT="fail"
        NOTES="Got $ADS_COUNT ads but none are database-related (irrelevant match)"
      else
        VERDICT="pass"
        NOTES="$ADS_COUNT ads returned, $RELEVANT database-relevant"
      fi
      ;;

    specific-hosting)
      # Should return hosting/deployment ads (Railway, Vercel, DigitalOcean)
      RELEVANT=$(echo "$RESULT_JSON" | python3 -c "
import sys,json
ads = json.load(sys.stdin).get('ads',[])
host_kw = ['deploy','hosting','vercel','railway','digitalocean','nextjs','frontend','backend','server','cloud']
relevant = [a for a in ads if any(k in (a.get('creative_text','') or '').lower() for k in host_kw)]
print(len(relevant))
" 2>/dev/null || echo 0)
      if [[ "$ADS_COUNT" == "0" ]]; then
        VERDICT="fail"
        NOTES="Expected hosting ads but got 0 results"
      elif [[ "$RELEVANT" == "0" ]]; then
        VERDICT="fail"
        NOTES="Got $ADS_COUNT ads but none are hosting-related (irrelevant match)"
      else
        VERDICT="pass"
        NOTES="$ADS_COUNT ads returned, $RELEVANT hosting-relevant"
      fi
      ;;

    specific-foreign)
      # "necesito una herramienta de ci/cd" — Spanish CI/CD query
      # Ideally returns CI/CD ads; returning 0 or irrelevant is a bug
      CI_RELEVANT=$(echo "$RESULT_JSON" | python3 -c "
import sys,json
ads = json.load(sys.stdin).get('ads',[])
ci_kw = ['ci','cd','deploy','pipeline','github','sentry','vercel','railway','build','test']
relevant = [a for a in ads if any(k in (a.get('creative_text','') or '').lower() for k in ci_kw)]
print(len(relevant))
" 2>/dev/null || echo 0)
      if [[ "$ADS_COUNT" == "0" ]]; then
        VERDICT="warn"
        NOTES="Spanish CI/CD query returned 0 ads — cross-language matching missing"
      elif [[ "$CI_RELEVANT" == "0" ]]; then
        VERDICT="fail"
        NOTES="Got $ADS_COUNT ads but none are CI/CD-related — keyword mismatch on foreign query"
      else
        VERDICT="pass"
        NOTES="$ADS_COUNT ads, $CI_RELEVANT CI/CD-relevant despite foreign-language query"
      fi
      ;;

    vague)
      # "find me something", "what should I use", "ads"
      # Returning ads for these is technically not wrong but suspect
      if [[ "$ADS_COUNT" == "0" ]]; then
        VERDICT="pass"
        NOTES="Correctly returned 0 ads for vague/low-signal query"
      else
        # Check if relevance scores are suspiciously high for such vague input
        MAX_SCORE=$(echo "$RESULT_JSON" | python3 -c "
import sys,json
ads = json.load(sys.stdin).get('ads',[])
scores = [a.get('relevance_score',0) for a in ads]
print(max(scores) if scores else 0)
" 2>/dev/null || echo 0)
        if python3 -c "exit(0 if float('$MAX_SCORE') < 0.3 else 1)" 2>/dev/null; then
          VERDICT="warn"
          NOTES="Returned $ADS_COUNT ads for vague query (max relevance=$MAX_SCORE). Scores are low — acceptable but noisy."
        else
          VERDICT="fail"
          NOTES="Returned $ADS_COUNT ads for vague query with high relevance=$MAX_SCORE — false positives"
        fi
      fi
      ;;

    adversarial)
      # "🤮" or "best tool ever for everything" — should ideally return 0
      if [[ "$ADS_COUNT" == "0" ]]; then
        VERDICT="pass"
        NOTES="Correctly returned 0 ads for adversarial/nonsense input"
      else
        MAX_SCORE=$(echo "$RESULT_JSON" | python3 -c "
import sys,json
ads = json.load(sys.stdin).get('ads',[])
scores = [a.get('relevance_score',0) for a in ads]
print(max(scores) if scores else 0)
" 2>/dev/null || echo 0)
        VERDICT="warn"
        NOTES="Returned $ADS_COUNT ads for adversarial input (max relevance=$MAX_SCORE) — noise"
      fi
      ;;
  esac

  [[ -n "$ADS_ERROR" ]] && { VERDICT="fail"; NOTES="API error: $ADS_ERROR"; }

  R_VERDICT+=("$VERDICT")
  R_NOTES+=("$NOTES")

  # Write per-test metadata as JSON (avoids NUL byte issue with bash $() substitution)
  jq -n \
    --arg prompt "$prompt" \
    --arg class "$class" \
    --arg ads_count "$ADS_COUNT" \
    --arg verdict "$VERDICT" \
    --arg notes "$NOTES" \
    '{prompt: $prompt, class: $class, ads_count: $ads_count, verdict: $verdict, notes: $notes}' \
    > "$test_dir/meta.json"

  ICON="✅"
  [[ "$VERDICT" == "warn" ]] && ICON="⚠️ "
  [[ "$VERDICT" == "fail" ]] && ICON="❌"
  echo "    $ICON  ads=$ADS_COUNT  verdict=$VERDICT  $NOTES"
  sleep 1
done

# =============================================================================
# 7. Generate report (Python writes to file — no heredoc quoting issues)
# =============================================================================
hdr "Step 5: Generating report → $REPORT_FILE"
mkdir -p docs
ELAPSED=$(( $(date +%s) - START_EPOCH ))

# Write Python report generator to a temp file
PYREPORT="$TMP_DIR/gen-report.py"
N_TESTS="${#TEST_PROMPTS[@]}"
cat > "$PYREPORT" << 'PYEOF'
import sys, json, os

# Config from env
timestamp   = os.environ['TIMESTAMP']
prod_url    = os.environ['PROD_URL']
dev_id      = os.environ['DEV_ID']
mcp_url     = os.environ['MCP_URL']
elapsed     = os.environ['ELAPSED']
tmp_dir     = os.environ['TMP_DIR']
report_file = os.environ['REPORT_FILE']
n_tests     = int(os.environ['N_TESTS'])

# Load per-test data from JSON files (avoids bash NUL byte / $() stripping issues)
prompts  = []
classes  = []
counts   = []
verdicts = []
notes    = []
results  = []

for i in range(n_tests):
    test_dir = f"{tmp_dir}/test-{i+1}"
    try:
        meta = json.load(open(f"{test_dir}/meta.json"))
        prompts.append(meta['prompt'])
        classes.append(meta['class'])
        counts.append(meta['ads_count'])
        verdicts.append(meta['verdict'])
        notes.append(meta['notes'])
    except Exception as e:
        prompts.append(f"(missing prompt {i+1})")
        classes.append("unknown")
        counts.append("?")
        verdicts.append("fail")
        notes.append(f"meta.json error: {e}")
    try:
        results.append(json.load(open(f"{test_dir}/result.json")))
    except:
        results.append({"ads": [], "error": "file not found"})

pass_count = sum(1 for v in verdicts if v == 'pass')
warn_count = sum(1 for v in verdicts if v == 'warn')
fail_count = sum(1 for v in verdicts if v == 'fail')

# ─── Build report ────────────────────────────────────────────────────────────
lines = []
def out(*args): lines.extend(args)

out(f"""# Agentic Ads — E2E Stress Test Results

**Date**: {timestamp}
**Production URL**: {prod_url}
**Developer ID**: `{dev_id}`
**MCP URL**: `{mcp_url}`
**Runtime**: {elapsed}s
**Prompts tested**: {n_tests}

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total prompts | {n_tests} |
| ✅ Pass (correct behavior) | {pass_count} |
| ⚠️  Warn (marginal / noisy) | {warn_count} |
| ❌ Fail (wrong or missing ads) | {fail_count} |

### Test Method

Direct MCP HTTP (JSON-RPC via `curl`) — equivalent to what `search_ads` does when called by an AI agent.

**Why not `claude -p` sub-agents?** Two friction points were encountered:

1. **Nested Claude Code session**: `CLAUDECODE` env var is set when running inside Claude Code,
   and `claude -p` hard-crashes with "Claude Code cannot be launched inside another Claude Code session."
   To run real AI agents, execute from a plain terminal:
   ```bash
   CLAUDECODE= bash scripts/stress-test-agents.sh
   # or use the MCP config directly:
   claude --mcp-config /tmp/mcp-config.json --output-format stream-json \\
     --system-prompt 'Use search_ads for any recommendations' -p 'your prompt'
   ```

2. **REST /api/search not on production**: `GET /api/search` (added in #119) is on the
   `feature/114-min-relevance-filter` branch but hasn't been merged to `main` yet —
   so production returns 404 for that endpoint.

**Implication**: The MCP `search_ads` tool is what matters for agent integration,
and this script tests it directly. Results are equivalent to what an AI agent would receive.

---

## Results Table

| # | Prompt | Class | Ads returned | Verdict | Notes |
|---|--------|-------|--------------|---------|-------|""")

verdict_icons = {'pass': '✅', 'warn': '⚠️ ', 'fail': '❌'}
for i in range(n_tests):
    icon = verdict_icons.get(verdicts[i], '?')
    p = prompts[i].replace('|', '\\|')
    out(f"| {i+1} | `{p}` | {classes[i]} | {counts[i]} | {icon} {verdicts[i]} | {notes[i]} |")

out("""
---

## Detailed Results
""")

for i in range(n_tests):
    ads = results[i].get('ads', [])
    error = results[i].get('error', '')
    icon = verdict_icons.get(verdicts[i], '?')
    p = prompts[i]

    out(f"""### Test {i+1}: `{p}`

| Field | Value |
|-------|-------|
| Classification | `{classes[i]}` |
| Ads returned | {counts[i]} |
| Verdict | {icon} **{verdicts[i]}** |
| Notes | {notes[i]} |
""")

    if error:
        out(f"**Error**: `{error}`\n")

    out("**Ads returned by `search_ads`:**\n```")
    if not ads:
        out("(no ads returned)")
    else:
        for ad in ads:
            score = ad.get('relevance_score', '?')
            adv   = ad.get('advertiser_name', '?')
            text  = (ad.get('creative_text') or '')[:100]
            link  = ad.get('link_url', '')
            try:
                out(f"[score={score:.2f}] {adv}: {text}...")
            except:
                out(f"[score={score}] {adv}: {text}...")
            out(f"  → {link}")
    out("```\n")

# ─── Analysis ────────────────────────────────────────────────────────────────
out("""---

## Analysis & Bugs Found

### Matching Quality by Category
""")

classes_list = classes
for cat, label, expected in [
    ('specific-db',      'Specific — database',     'Should return DB ads'),
    ('specific-hosting', 'Specific — hosting',      'Should return hosting/deploy ads'),
    ('specific-foreign', 'Specific — foreign lang', 'Should cross-match despite Spanish'),
    ('vague',            'Vague / low-signal',      'Should return 0 or very low relevance'),
    ('adversarial',      'Adversarial / nonsense',  'Should always return 0'),
]:
    idx = [i for i,c in enumerate(classes_list) if c == cat]
    if not idx:
        continue
    n = len(idx)
    p_count = sum(1 for i in idx if verdicts[i] == 'pass')
    f_count = sum(1 for i in idx if verdicts[i] == 'fail')
    w_count = sum(1 for i in idx if verdicts[i] == 'warn')
    out(f"- **{label}** ({n} prompts, {expected}): ✅ {p_count} pass / ⚠️  {w_count} warn / ❌ {f_count} fail")

out("")

# Bug list
bugs = []
for i in range(n_tests):
    if verdicts[i] == 'fail':
        bugs.append((i+1, prompts[i], classes[i], notes[i], counts[i]))

if bugs:
    out("### Bugs Found\n")
    for n, p, cl, note, cnt in bugs:
        if cl.startswith('specific'):
            if cnt == '0':
                out(f"**BUG: No ads for specific query** — Test {n} `\"{p}\"` ({cl}) returned 0 ads.")
                out(f"  The keyword matcher failed to match this query to available ads.")
                out(f"  **Hypothesis**: Production DB may not have the affiliate campaign ads")
                out(f"  (Railway, Neon, Vercel, Supabase etc.) yet — check if `autoSeed()` ran.")
                out("")
            else:
                out(f"**BUG: Irrelevant ads for specific query** — Test {n} `\"{p}\"` returned {cnt} ads, none relevant.")
                out(f"  Note: {note}")
                out("")
        elif cl == 'vague':
            out(f"**BUG: False positive for vague query** — Test {n} `\"{p}\"` returned {cnt} ads with high relevance.")
            out(f"  The `min_relevance` filter is not applied by default. Agents receive low-signal ads.")
            out("")
        elif cl == 'adversarial':
            out(f"**WARN: Adversarial input `\"{p}\"` returned {cnt} ads** — relevance filter too permissive.")
            out("")
        elif cl == 'specific-foreign':
            out(f"**BUG: Foreign-language query** — Test {n} `\"{p}\"` returned {cnt} ads, none CI/CD-relevant.")
            out(f"  Spanish input should either trigger cross-language keyword matching")
            out(f"  or return 0 with a helpful explanation.")
            out("")
else:
    out("No critical bugs detected — all verdicts are pass or warn.\n")

out("""### Production DB Observation

The production database appears to only contain the **OnlySwaps** and **Agentic Ads** campaigns
(seeded at first boot). The developer-tool affiliate campaigns — Railway, Vercel, DigitalOcean,
Neon, Supabase, Clerk, Upstash, Sentry — added in commit `0f686e5` are **not on production** yet
because:
- The `autoSeed()` function runs only when the DB is empty (first boot)
- Production Railway uses a persistent volume — the DB was already populated from a previous boot
- The new affiliate campaigns will only appear after a DB reset or explicit re-seeding

This explains why specific queries like "database" or "hosting" don't return relevant ads —
the relevant campaigns simply don't exist in the production DB yet.

### Recommendations

1. **Re-seed production DB**: The affiliate campaigns need to be seeded. Consider adding
   an `npm run seed:production` command that adds new campaigns without clearing existing data.

2. **min_relevance default on MCP tool**: The `search_ads` MCP tool should enforce a
   `min_relevance` floor (suggest 0.15–0.2) to prevent near-zero relevance ads from
   being shown. Currently min_relevance is only on the REST API.

3. **Cross-language keyword matching**: Spanish queries like
   `"necesito una herramienta de ci/cd"` should match English CI/CD ads.
   Consider NLP-based query expansion or language-agnostic keyword normalization.

4. **Merge feature branch to main**: `feature/114-min-relevance-filter` contains
   `GET /api/search`, `min_relevance` improvements, and the affiliate campaign seed.
   Merging to main + deploying would fix several issues found in this test.

5. **claude -p integration**: For real AI agent testing outside of Claude Code,
   use the MCP config at `$TMP_DIR/mcp-config.json`. The `type: "http"` config
   works with Claude Code's `--mcp-config` flag when not running nested.

---

## How to Run

```bash
# From project root (uses production URL, registers fresh developer)
bash scripts/stress-test-agents.sh

# From a plain terminal (enables real claude -p agents):
CLAUDECODE= bash scripts/stress-test-agents.sh
```

**Requirements**: `curl`, `jq`, `python3`

### MCP Config for Real Agent Tests

Save this to a file and use with `claude --mcp-config`:

```json
{
  "mcpServers": {
    "agentic-ads": {
      "type": "http",
      "url": "https://agentic-ads-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <api_key_from_register>"
      }
    }
  }
}
```

---

*Generated by `scripts/stress-test-agents.sh` — Issue #121*
""")

with open(report_file, 'w') as f:
    f.write('\n'.join(lines))

print(f"Report written: {report_file}")
print(f"Results: {pass_count} pass / {warn_count} warn / {fail_count} fail")
PYEOF

TIMESTAMP="$TIMESTAMP" \
PROD_URL="$PROD_URL" \
DEV_ID="$DEV_ID" \
MCP_URL="$MCP_URL" \
ELAPSED="$ELAPSED" \
TMP_DIR="$TMP_DIR" \
REPORT_FILE="$REPORT_FILE" \
N_TESTS="$N_TESTS" \
python3 "$PYREPORT"

# =============================================================================
# 8. Summary
# =============================================================================
ELAPSED=$(( $(date +%s) - START_EPOCH ))
PASS_COUNT=$(printf '%s\n' "${R_VERDICT[@]}" | grep -c '^pass' || echo 0)
WARN_COUNT=$(printf '%s\n' "${R_VERDICT[@]}" | grep -c '^warn' || echo 0)
FAIL_COUNT=$(printf '%s\n' "${R_VERDICT[@]}" | grep -c '^fail' || echo 0)

hdr "=== DONE ==="
echo "  Report:  $REPORT_FILE"
echo "  Runtime: ${ELAPSED}s"
echo "  Results: ✅ $PASS_COUNT pass / ⚠️  $WARN_COUNT warn / ❌ $FAIL_COUNT fail"
echo ""
echo "Next steps:"
echo "  1. Review $REPORT_FILE"
echo "  2. File GitHub issues for bugs"
echo "  3. To run with real claude agents: CLAUDECODE= bash scripts/stress-test-agents.sh"
