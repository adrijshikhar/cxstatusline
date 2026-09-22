#!/usr/bin/env bash
set -euo pipefail

# fetch-diff.sh - Fetches commit diffs via gh api or local git checkout.
#
# Usage:
#   fetch-diff.sh <commit-or-range> [--cc-checkout <path>] [--stat]
#   fetch-diff.sh --help

if [[ $# -eq 0 || "$1" == "--help" || "$1" == "-h" ]]; then
  echo "Usage: $0 <commit-or-range> [--cc-checkout <path>] [--stat]"
  echo ""
  echo "Arguments:"
  echo "  <commit-or-range>   Git commit SHA (e.g. 747b7f1) or range (e.g. A...B)"
  echo "Options:"
  echo "  --cc-checkout <dir> Path to local clone of ccstatusline"
  echo "  --stat              Show diffstat summary instead of full patch"
  exit 0
fi

TARGET="$1"
shift

CHECKOUT=""
STAT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cc-checkout)
      CHECKOUT="$2"
      shift 2
      ;;
    --stat)
      STAT=true
      shift
      ;;
    *)
      if [[ -z "$CHECKOUT" && -d "$1" ]]; then
        CHECKOUT="$1"
        shift
      else
        echo "Error: Unknown option or argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -n "$CHECKOUT" ]]; then
  if [[ "$STAT" == true ]]; then
    git -C "$CHECKOUT" show --stat "$TARGET"
  else
    git -C "$CHECKOUT" show "$TARGET"
  fi
  exit 0
fi

REPO="sirmalloc/ccstatusline"

if [[ "$TARGET" == *"..."* ]]; then
  ENDPOINT="repos/${REPO}/compare/${TARGET}"
else
  ENDPOINT="repos/${REPO}/commits/${TARGET}"
fi

if [[ "$STAT" == true ]]; then
  gh api "$ENDPOINT" --jq 'if .stats then ("Stats: +" + (.stats.additions|tostring) + " -" + (.stats.deletions|tostring) + " (total " + (.stats.total|tostring) + ")\n" + ([.files[]? | "  " + .status + " (+" + (.additions|tostring) + "/-" + (.deletions|tostring) + ") " + .filename] | join("\n"))) else "No stats found" end'
else
  gh api "$ENDPOINT" -H "Accept: application/vnd.github.v3.diff"
fi
