#!/usr/bin/env bash
# Adapted from OpenAI Codex .github/actions/setup-rusty-v8/action.yml (Apache-2.0).
# Our upstream checkout is nested, unlike Codex's own release workflow.
set -euo pipefail

upstream="$1"
target="$2"
case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu) ;;
  *) echo "Unsupported V8 target: $target" >&2; exit 1 ;;
esac
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

version="$(python3 "$upstream/.github/scripts/rusty_v8_bazel.py" resolved-v8-crate-version)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
base_url="https://github.com/openai/codex/releases/download/rusty-v8-v${version}"
profile="ptrcomp_sandbox_release"
archive="librusty_v8_${profile}_${target}.a.gz"
binding="src_binding_${profile}_${target}.rs"
checksums="rusty_v8_${profile}_${target}.sha256"
staging="$(mktemp -d "$RUNNER_TEMP/cx-v8.XXXXXX")"

for file in "$archive" "$binding" "$checksums"; do
  curl --fail --silent --show-error --location --retry 2 \
    --connect-timeout 20 --max-time 600 "$base_url/$file" -o "$staging/$file"
done

# Accept only the two expected basenames before letting shasum read any paths.
awk -v archive="$archive" -v binding="$binding" '
  { sub(/\r$/, ""); if (NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/) exit 1;
    if ($2 == archive) a++; else if ($2 == binding) b++; else exit 1 }
  END { if (NR != 2 || a != 1 || b != 1) exit 1 }
' "$staging/$checksums"
(cd "$staging" && tr -d '\r' < "$checksums" | (sha256sum -c - 2>/dev/null || shasum -a 256 -c -))
printf 'RUSTY_V8_ARCHIVE=%s\nRUSTY_V8_SRC_BINDING_PATH=%s\n' \
  "$staging/$archive" "$staging/$binding" >> "$GITHUB_ENV"
