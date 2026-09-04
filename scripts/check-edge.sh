#!/bin/bash
# Report only the diagnostics that matter for Deno edge functions.
#
# Module errors are expected: the TypeScript compiler cannot resolve Deno's URL
# imports, and teaching it to would mean vendoring every remote dependency for
# no benefit. What is NOT expected, and what shipped to production once, is an
# identifier used but never declared.
cd "$(dirname "$0")/.." 2>/dev/null || true
OUT=$(npx tsc -p tsconfig.edge.json 2>&1 | grep -vE "TS2307|TS2792|TS2306|Cannot find module")
echo "$OUT" | grep -E "error TS" || true
N=$(echo "$OUT" | grep -c "error TS")
if [ "$N" -gt 0 ]; then
  echo "  $N edge-function error(s)"; exit 1
else
  echo "  edge functions: no undefined names or type errors"
fi
