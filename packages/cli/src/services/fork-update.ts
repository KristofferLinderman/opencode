export const forkUpdatePrompt = (version: string) => `Update my personal OpenCode fork to the official stable release v${version.replace(/^v/, "")}.

Fork checkout: /Users/kristoffer/Code/Web/opencode
Local launcher: /Users/kristoffer/Code/Web/opencode/.cache/bin/opencode-local

1. Read the checkout's AGENTS.md and inspect its branch, remotes, working changes, and existing fork commits. This chat may be in a different project: make all update changes in the fork checkout above.
2. Preserve all personal customizations and uncommitted work. Never reset, discard, overwrite, automatically stash, commit, or push my changes. If the working tree blocks a safe merge, ask me how to preserve it before continuing.
3. Verify the upstream remote is anomalyco/opencode. Fetch the official v${version.replace(/^v/, "")} release tag and merge that exact stable tag into the personal branch, not upstream/dev or a development release. Resolve conflicts preserving fork behavior; ask when intent is unclear.
4. Keep stable-only update notifications, the pre-update changelog modal, and this fork-aware /update prompt workflow. Keep the dev runtime/storage channel; do not switch to official binaries or run the normal installer/package-manager upgrade.
5. Run focused tests and the repository's required checks. Use the Bun version required by package.json without replacing my global Bun installation.
6. Rebuild the local CLI for this machine using OPENCODE_CHANNEL=dev and OPENCODE_VERSION=${version.replace(/^v/, "")} with packages/cli/script/build.ts --single --skip-install. Preserve the local launcher's target at /Users/kristoffer/Code/Web/opencode/packages/cli/dist/cli-darwin-arm64/bin/opencode. Do not restart the running app or shared service without asking.
7. Report the upstream changes, any conflicts or verification failures, and the resulting binary version. Tell me when to restart the fork to test it.`
