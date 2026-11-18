import { expect, test } from "bun:test"
import { forkUpdatePrompt } from "./fork-update"

test("hands the exact stable release to the fork update script", () => {
  const prompt = forkUpdatePrompt("2.3.0")
  expect(prompt).toContain("official stable release v2.3.0")
  expect(prompt).toContain("In /Users/kristoffer/Code/Web/opencode, run `script/fork-update.sh 2.3.0`")
  expect(prompt).toContain("git log v2.3.0..HEAD --no-merges")
  expect(prompt).toContain("Never reset, force-push or discard work")
  expect(prompt).toContain("Don't restart the running app or shared service")
  expect(forkUpdatePrompt("v2.3.0")).toBe(prompt)
})
