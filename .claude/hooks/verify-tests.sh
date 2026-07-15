#!/usr/bin/env bash
# Stop hook — refuse to end a turn on a red test suite.
#
# Why this exists: every defect in docs/CHANGE-LEDGER.md is pinned by a regression
# test. A red suite therefore may mean a past fix has just been undone. Enforcing it
# here (rather than in CLAUDE.md) makes it mechanical instead of advisory.
set -uo pipefail

input=$(cat)

# Claude Code re-fires the Stop hook after the model responds to a block. If we have
# already blocked once this turn, let it stop — otherwise a genuinely unfixable
# failure would trap the session in a loop. One enforced attempt; after that the
# model must surface the failure rather than silently ship it.
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi

cd "$(dirname "$0")/../.." || exit 0
[ -d node_modules ] || exit 0   # deps not installed — nothing to verify, don't block

if out=$(npx jest --silent 2>&1); then
  exit 0
fi

{
  echo "BLOCKED: the jest suite is red — do not end the turn with failing tests."
  echo
  echo "Every fixed defect in docs/CHANGE-LEDGER.md is pinned by a regression test, so"
  echo "a red suite may mean a past fix (CB-01..CB-04) has just been reintroduced. Read"
  echo "the ledger entry for the failing test before changing it."
  echo
  echo "If a snapshot changed INTENTIONALLY, verify the diff is only what you intended,"
  echo "then re-baseline with 'npm run test:update' and log it in the ledger."
  echo
  printf '%s\n' "$out" | tail -40
} >&2
exit 2
