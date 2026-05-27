#!/usr/bin/env bash
# test-orchestrator.sh — Full orchestrator test workflow.
# Run: bash scripts/test-orchestrator.sh
# Or:  bun run test:orchestrator
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

pass=0
fail=0

step() { echo -e "\n${CYAN}${BOLD}▸ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓ $1${RESET}"; pass=$((pass + 1)); }
err()  { echo -e "  ${RED}✗ $1${RESET}"; fail=$((fail + 1)); }

extract_count() {
  # Usage: extract_count "149 pass" "pass" → 149
  echo "$1" | grep -oE "[0-9]+ $2" | head -1 | grep -oE '[0-9]+' || echo 0
}

# ── 1. Typecheck ──────────────────────────────────────────────
step "Typecheck"
if bun run typecheck >/dev/null 2>&1; then
  ok "tsc --noEmit passed"
else
  bun run typecheck 2>&1 | tail -5
  err "typecheck failed"
fi

# ── 2. Line ceiling ──────────────────────────────────────────
step "Line ceiling (200 max)"
over=0
for f in src/orchestrator/*.ts src/agent/glorp.ts src/agent/runtime/assemble.ts; do
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt 200 ]; then
    err "$f: $lines lines"
    over=1
  fi
done
if [ "$over" -eq 0 ]; then
  ok "all orchestrator files ≤ 200 lines"
fi

# ── 3. Orchestrator unit tests ────────────────────────────────
step "Orchestrator tests"
output=$(bun test tests/orchestrator/ 2>&1)
orch_pass=$(extract_count "$output" "pass")
orch_fail=$(extract_count "$output" "fail")
if [ "$orch_fail" -eq 0 ] && [ "$orch_pass" -gt 0 ]; then
  ok "$orch_pass orchestrator tests passed"
else
  echo "$output" | grep -E '^\(fail\)' | head -10
  err "$orch_fail orchestrator test(s) failed out of $orch_pass"
fi

# ── 4. Full test suite ────────────────────────────────────────
step "Full test suite"
output=$(bun test tests/ 2>&1)
full_pass=$(extract_count "$output" "pass")
full_fail=$(extract_count "$output" "fail")
if [ "$full_fail" -eq 0 ] && [ "$full_pass" -gt 0 ]; then
  ok "$full_pass total tests passed (no regressions)"
else
  echo "$output" | grep -E '^\(fail\)' | head -10
  err "$full_fail test(s) failed in full suite"
fi

# ── 5. Barrel export check ────────────────────────────────────
step "Barrel export check"
barrel="src/orchestrator/index.ts"
missing=0
for sym in Orchestrator OrchestratorEventBus Scheduler ForwardingDisplayManager \
           FileMeshAdapter mountAgentMesh teardownAgentMesh runGenEvalLoop \
           runPlanPhase spawnAgentTool generatorBlueprint evaluatorBlueprint \
           PLAN_READY FEATURE_COMPLETE parseVerdict roleDef ROLE_DEFS; do
  if ! grep -q "$sym" "$barrel"; then
    err "missing export: $sym"
    missing=1
  fi
done
if [ "$missing" -eq 0 ]; then
  ok "all key symbols exported from index.ts"
fi

# ── Summary ───────────────────────────────────────────────────
echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
total=$((pass + fail))
if [ "$fail" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All $total checks passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$fail/$total checks failed.${RESET}"
  exit 1
fi
