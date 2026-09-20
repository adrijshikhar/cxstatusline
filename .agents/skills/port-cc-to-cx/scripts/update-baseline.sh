#!/usr/bin/env bash
set -euo pipefail

# update-baseline.sh - Updates upstream-ccstatusline.json and reminds/validates NOTICE.
#
# Usage:
#   update-baseline.sh <commit-sha> [repo]
#   update-baseline.sh --help

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../../../" && pwd)"
CONFIG_FILE="${ROOT_DIR}/scripts/upstream-ccstatusline.json"
NOTICE_FILE="${ROOT_DIR}/NOTICE"

if [[ $# -eq 0 || "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Usage: $0 <commit-sha> [repo]"
  echo ""
  echo "Arguments:"
  echo "  <commit-sha>  Git commit SHA (e.g. 05554cd087249167d570aed3c869915b6a18d4d2)"
  echo "  [repo]        Upstream repo (default: sirmalloc/ccstatusline)"
  exit 0
fi

NEW_COMMIT="$1"
REPO="${2:-sirmalloc/ccstatusline}"

if [[ ${#NEW_COMMIT} -lt 7 ]]; then
  echo "Error: commit SHA must be at least 7 characters, got '${NEW_COMMIT}'" >&2
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: Config file not found at ${CONFIG_FILE}" >&2
  exit 1
fi

# Update scripts/upstream-ccstatusline.json using node or bun fallback
if command -v node >/dev/null 2>&1; then
  JS_CMD="node"
elif command -v bun >/dev/null 2>&1; then
  JS_CMD="bun"
else
  echo "Error: Neither 'node' nor 'bun' command was found in PATH." >&2
  exit 1
fi

"$JS_CMD" -e "
const fs = require('fs');
const file = process.argv[1];
const repo = process.argv[2];
const commit = process.argv[3];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.repo = repo;
data.baseCommit = commit;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
" "$CONFIG_FILE" "$REPO" "$NEW_COMMIT"

echo "✅ Updated ${CONFIG_FILE} baseCommit to ${NEW_COMMIT}"

if [[ -f "$NOTICE_FILE" ]]; then
  echo "ℹ️  Checked NOTICE file. Please ensure newly derived files and ${NEW_COMMIT:0:7} are referenced in ${NOTICE_FILE}."
else
  echo "⚠️  NOTICE file not found at ${NOTICE_FILE}"
fi
