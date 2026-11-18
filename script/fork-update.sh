#!/usr/bin/env bash
# Updates the personal fork to an official stable release: merge the tag, check, test, build, push.
#
#   script/fork-update.sh 2.3.2
#
# Exit codes: 0 done, 1 failure (see the log it names), 2 merge conflicts to resolve.
# After resolving conflicts, `git add` the files and run the same command again; it commits the merge and continues.
set -euo pipefail

version="${1:-}"
version="${version#v}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: script/fork-update.sh <stable version, e.g. 2.3.2>" >&2
  exit 1
fi
tag="v$version"

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
logs="$repo/.cache/fork-update-$tag"
mkdir -p "$logs"

step() { printf '\n==> %s\n' "$*"; }
fail() {
  echo "FAILED: $*" >&2
  exit 1
}
# Runs a command with its output in a log, printing only the tail when it fails.
logged() {
  local name="$1"
  shift
  if ! "$@" >"$logs/$name.log" 2>&1; then
    tail -40 "$logs/$name.log" >&2
    fail "$name (full log: $logs/$name.log)"
  fi
}

# --- Bun: use the version package.json pins, in a repo-local toolchain, never the global install.
step "Bun toolchain"
bun_version="$(sed -n 's/.*"packageManager": *"bun@\([^"]*\)".*/\1/p' package.json)"
[ -n "$bun_version" ] || fail "packageManager bun version not found in package.json"
toolchain="$repo/.cache/toolchain"
bun_dir="$toolchain/bun-darwin-aarch64"
if [ ! -x "$bun_dir/bun" ] || [ "$("$bun_dir/bun" --version)" != "$bun_version" ]; then
  echo "installing bun $bun_version into $toolchain"
  rm -rf "$toolchain"
  mkdir -p "$toolchain"
  base="https://github.com/oven-sh/bun/releases/download/bun-v$bun_version"
  curl -fsSL "$base/bun-darwin-aarch64.zip" -o "$toolchain/bun-darwin-aarch64.zip"
  curl -fsSL "$base/SHASUMS256.txt" -o "$toolchain/SHASUMS256.txt"
  (cd "$toolchain" && grep ' bun-darwin-aarch64.zip$' SHASUMS256.txt | shasum -a 256 -c -) || fail "bun checksum mismatch"
  unzip -q "$toolchain/bun-darwin-aarch64.zip" -d "$toolchain"
fi
export PATH="$bun_dir:$PATH"
echo "bun $(bun --version)"

# --- Repository state.
step "Preflight"
upstream_url="$(git remote get-url upstream 2>/dev/null || true)"
[[ "$upstream_url" == *anomalyco/opencode* ]] || fail "remote 'upstream' is '$upstream_url', expected anomalyco/opencode"
if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  fail "a rebase is in progress"
fi
git fetch --quiet upstream "refs/tags/$tag:refs/tags/$tag" || fail "could not fetch $tag from upstream"
target="$(git rev-parse "$tag^{commit}")"

merge_head="$(git rev-parse -q --verify MERGE_HEAD || true)"
if [ -n "$merge_head" ]; then
  [ "$merge_head" = "$target" ] || fail "an unrelated merge is in progress (MERGE_HEAD $merge_head)"
  unmerged="$(git diff --name-only --diff-filter=U)"
  [ -z "$unmerged" ] || {
    echo "$unmerged"
    echo "Resolve and 'git add' these, then re-run." >&2
    exit 2
  }
  step "Committing resolved merge of $tag"
  git commit --no-verify --no-edit -q
elif ! git merge-base --is-ancestor "$target" HEAD; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "working tree has uncommitted changes; commit them first"
  step "Merging $tag"
  if ! git merge --no-ff --no-verify -m "chore: merge stable $tag into personal fork" "$tag" >"$logs/merge.log" 2>&1; then
    unmerged="$(git diff --name-only --diff-filter=U)"
    if [ -n "$unmerged" ]; then
      echo "Conflicts (rerere may have pre-resolved others):"
      echo "$unmerged"
      echo "Resolve and 'git add' these, then re-run: script/fork-update.sh $version" >&2
      exit 2
    fi
    # rerere resolved everything it recorded before.
    git commit --no-verify --no-edit -q
  fi
else
  echo "$tag already merged"
fi

# --- Verify.
step "Install"
logged install bun install

step "Check (lint + typecheck)"
logged check bun run check

step "Fork tests"
# Every test file the fork adds or changes, run from its package so package-level setup applies.
fork_tests="$(git diff --name-only "$tag" HEAD -- 'packages/*' | grep -E '\.test\.tsx?$' || true)"
for package in $(echo "$fork_tests" | cut -d/ -f1-2 | sort -u); do
  files="$(echo "$fork_tests" | grep "^$package/" | sed "s#^$package/##" | while read -r file; do [ -f "$package/$file" ] && echo "$file"; done)"
  [ -n "$files" ] || continue
  echo "$package: $(echo "$files" | wc -l | tr -d ' ') files"
  # shellcheck disable=SC2086
  logged "test-$(basename "$package")" bash -c "cd '$package' && bun test $(echo $files)"
done

# --- Build and confirm the binary is the fork at this version.
step "Build"
logged build env OPENCODE_CHANNEL=dev OPENCODE_VERSION="$version" bash -c "cd packages/cli && bun script/build.ts --single --skip-install"
binary="$repo/packages/cli/dist/cli-darwin-arm64/bin/opencode"
built="$("$binary" --version)"
[ "$built" = "opencode $tag" ] || fail "binary reports '$built', expected 'opencode $tag'"
grep -q "Prepare update" "$binary" || fail "binary is missing the fork's update modal"
echo "$built"

step "Push"
logged push git push

step "Done: $tag merged, checked, built and pushed. Restart opencode to use it."
