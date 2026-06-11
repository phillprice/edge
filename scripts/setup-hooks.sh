#!/bin/sh
# One-time setup: point git at the repo's tracked hooks in .githooks/.
# Run from anywhere in the repo:  sh scripts/setup-hooks.sh
set -e
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
echo "✓ git hooks enabled (core.hooksPath = .githooks)"
if ! python3 -c 'import lizard' >/dev/null 2>&1; then
  echo "ℹ optional: 'pip install lizard' to enable the complexity check (mirrors Codacy)"
fi
