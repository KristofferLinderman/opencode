#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
binary="$repo/packages/cli/dist/cli-darwin-arm64/bin/opencode"
version="${1:-$("$binary" --version)}"
version="${version#opencode v}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Expected a stable version, got: $version" >&2; exit 1; }
bun_dir="$repo/.cache/toolchain/bun-darwin-aarch64"
[ -x "$bun_dir/bun" ] || { echo "Missing fork toolchain: $bun_dir/bun" >&2; exit 1; }
export PATH="$bun_dir:$PATH"

lock="$repo/.cache/fork-build.lock"
mkdir "$lock" || { echo "Another fork build is running (lock: $lock)." >&2; exit 1; }
staged=""
out="$lock/dist"
trap 'if [ -n "$staged" ]; then rm -f -- "$staged"; fi; rm -rf -- "$out"; rmdir "$lock"' EXIT
log="$(mktemp "$repo/.cache/fork-build.XXXXXX")"
cd "$repo/packages/cli"
if ! OPENCODE_CHANNEL=dev OPENCODE_VERSION="$version" bun script/build.ts --single --skip-install --skip-web-ui --outdir="$out" >"$log" 2>&1; then
  tail -12 "$log" >&2
  echo "Build log: $log" >&2
  exit 1
fi
staged="$(mktemp "$binary.new.XXXXXX")"
install -m 755 "$out/cli-darwin-arm64/bin/opencode" "$staged"
[ "$("$staged" --version)" = "opencode v$version" ]
mv -f -- "$staged" "$binary"
echo "Built opencode v$version (log: $log)"
