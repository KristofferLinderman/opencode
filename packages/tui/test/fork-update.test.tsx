import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test.each([true, false])("/update inserts an editable fork prompt (cached notice: %s)", async (cached) => {
  let checks = 0
  let installs = 0
  const mutations: string[] = []
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    updater: {
      remote: false,
      prompt: (version) => `Update my fork to stable v${version}.`,
      changelog: async () => notes,
      subscribe: (notify) => {
        if (cached) notify({ type: "available", version: "2.3.0" })
        return () => {}
      },
      check: async () => {
        checks++
        return { type: "available", version: "2.3.0" }
      },
      apply: async () => {
        installs++
      },
    },
    fetch: async (url, request) => {
      if (request.method === "POST") mutations.push(url.pathname)
    },
  })
  await readyInput(setup)
  await setup.mockInput.typeText("/update")
  await setup.waitForFrame((frame) => frame.includes("Update OpenCode"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Background Subagents"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => {
    const input = setup.renderer.currentFocusedRenderable
    return input instanceof TextareaRenderable && input.plainText === "Update my fork to stable v2.3.0."
  })
  expect(checks).toBe(cached ? 0 : 1)
  expect(installs).toBe(0)
  expect(mutations).toEqual([])
})

test("fork update preserves an existing draft and does not install or submit", async () => {
  let installs = 0
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    updater: {
      remote: false,
      prompt: (version) => `Update my fork to v${version}.`,
      changelog: async () => notes,
      subscribe: () => () => {},
      check: async () => ({ type: "available", version: "2.3.0" }),
      apply: async () => {
        installs++
      },
    },
  })
  await readyInput(setup)
  await setup.mockInput.typeText("Keep this draft.")
  await openUpdate(setup)
  await setup.waitForFrame((frame) => frame.includes("Prepare update"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame(() => {
    const input = setup.renderer.currentFocusedRenderable
    return input instanceof TextareaRenderable && input.plainText === "Keep this draft.\n\nUpdate my fork to v2.3.0."
  })
  expect(installs).toBe(0)
})

test.each(["current", "failed"])("fork update leaves the draft intact when the check is %s", async (status) => {
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    updater: {
      remote: false,
      prompt: () => "Must not insert this.",
      subscribe: () => () => {},
      check: async () => {
        if (status === "failed") throw new Error("Release check failed")
        return undefined
      },
      apply: async () => {
        throw new Error("Must not install")
      },
    },
  })
  await readyInput(setup)
  await setup.mockInput.typeText("Keep this draft.")
  await openUpdate(setup)
  await setup.waitForFrame((frame) =>
    frame.includes(status === "failed" ? "Release check failed" : "No stable OpenCode update available."),
  )
  const input = setup.renderer.currentFocusedRenderable
  expect(input).toBeInstanceOf(TextareaRenderable)
  expect((input as TextareaRenderable).plainText).toBe("Keep this draft.")
})

test("fork update shows the changelog and Skip leaves the draft untouched", async () => {
  const requested: { current: string; target: string }[] = []
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    updater: {
      remote: false,
      prompt: () => "Must not insert this.",
      changelog: async (input) => {
        requested.push({ current: input.current, target: input.target })
        return notes
      },
      subscribe: () => () => {},
      check: async () => ({ type: "available", version: "2.3.0" }),
      apply: async () => {
        throw new Error("Must not install")
      },
    },
  })
  await readyInput(setup)
  await setup.mockInput.typeText("Keep this draft.")
  await openUpdate(setup)
  await setup.waitForFrame((frame) => frame.includes("Background Subagents") && frame.includes("Shell survives"))
  expect(requested.map((item) => item.target)).toEqual(["2.3.0"])
  setup.mockInput.pressArrow("left")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes("Prepare update"))
  const input = setup.renderer.currentFocusedRenderable
  expect(input).toBeInstanceOf(TextareaRenderable)
  expect((input as TextareaRenderable).plainText).toBe("Keep this draft.")
})

const notes = [
  {
    version: "2.3.0",
    breaking: [],
    features: [{ title: "Background Subagents", body: "Subagents run in the background." }],
    improved: ["Shell survives handoffs."],
    fixed: [],
  },
]

async function openUpdate(setup: Awaited<ReturnType<typeof createAppFixture>>) {
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
  await setup.mockInput.typeText("Update OpenCode")
  await setup.waitForFrame((frame) => frame.includes("Update OpenCode"))
  setup.mockInput.pressEnter()
}

async function readyInput(setup: Awaited<ReturnType<typeof createAppFixture>>) {
  await setup.ready
  await setup.waitForFrame(() => setup.renderer.currentFocusedRenderable instanceof TextareaRenderable)
  const input = setup.renderer.currentFocusedRenderable as TextareaRenderable
  // Home-route drafts are retained across app mounts in this process.
  if (!input.plainText) return
  setup.mockInput.pressKey("c", { ctrl: true })
  await setup.waitForFrame(() => input.plainText === "")
}
