import { expect, test } from "bun:test"
import { forkUpdatePrompt } from "./fork-update"

test("prepares instructions for the exact stable release without replacing the fork", () => {
  const prompt = forkUpdatePrompt("2.3.0")
  expect(prompt).toContain("official stable release v2.3.0")
  expect(prompt).toContain("Fork checkout: /Users/kristoffer/Code/Web/opencode")
  expect(prompt).toContain("merge that exact stable tag")
  expect(prompt).toContain("uncommitted work")
  expect(prompt).toContain("OPENCODE_CHANNEL=dev and OPENCODE_VERSION=2.3.0")
  expect(prompt).toContain("without replacing my global Bun installation")
  expect(prompt).toContain("Do not restart the running app or shared service without asking")
  expect(forkUpdatePrompt("v2.3.0")).toBe(prompt)
})
