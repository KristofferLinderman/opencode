const FORK = "/Users/kristoffer/Code/Web/opencode"
const binary = `${FORK}/packages/cli/dist/cli-darwin-arm64/bin/opencode`
const script = `${FORK}/script/fork-build.sh`

export const forkRebuildAverageSeconds = 14

export const forkRebuild = async () => {
  const build = Bun.spawn(["/bin/bash", script], { stdout: "ignore", stderr: "pipe" })
  const stderr = await new Response(build.stderr).text()
  if ((await build.exited) !== 0) throw new Error(stderr.trim() || "OpenCode build failed.")
}

export const forkCanRebuild = async () =>
  process.execPath === binary && typeof process.execve === "function" && (await Bun.file(script).exists())

export const forkUpdatePrompt = (input: string) => {
  const version = input.replace(/^v/, "")
  return `Update my personal OpenCode fork to the official stable release v${version}.

In ${FORK}, run \`script/fork-update.sh ${version}\`. It merges the tag, installs, checks, runs the fork's tests, builds the local binary and pushes, logging to .cache/fork-update-v${version}/.

- Exit 2 (merge conflicts): resolve them keeping both upstream changes and the fork's behavior (fork commits: \`git log v${version}..HEAD --no-merges\`), ask me when intent is unclear, \`git add\` the files and re-run the script.
- Exit 1: read the named log, fix the cause in a separate fork commit, and re-run.
- Never reset, force-push or discard work. Don't restart the running app or shared service.

Finally report any conflicts and how you resolved them, other fixes, and the built binary version.`
}
