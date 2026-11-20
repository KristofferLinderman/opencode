import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"
import { Locale } from "../src/util/locale"

for (const width of [100, 44]) {
  test.each(["footer", "header", "divider"] as const)(
    `message timestamps use %s layout at ${width} columns`,
    async (layout) => {
      const sent = new Date(2026, 10, 12, 9, 14).getTime()
      const completed = sent + 65_000
      const olderSent = sent - 180_000
      const olderCompleted = olderSent + 65_000
      const sessionID = `ses_timestamps_${layout}_${width}`
      const [prompt, response] = [
        { id: "message-1", type: "user", text: "Timestamp prompt", time: { created: sent } },
        {
          id: "message-2",
          type: "assistant",
          agent: "build",
          model: { providerID: "demo", id: "demo-model" },
          content: [{ id: "part-1", type: "text", text: "Timestamp response" }],
          finish: "stop",
          time: { created: sent + 1_000, streamed: sent + 11_000, completed },
          tokens: { input: 10, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      ] satisfies [object, object]
      const messages = [prompt, response]
      if (layout === "divider") {
        messages.unshift(
          { ...prompt, id: "older-1", text: "Older prompt", time: { created: olderSent } },
          {
            ...response,
            id: "older-2",
            content: [{ id: "older-part", type: "text", text: "Old reply" }],
            time: { created: olderSent, streamed: olderSent + 11_000, completed: olderCompleted },
          },
        )
      }
      await using setup = await createAppFixture({
        width,
        height: 40,
        config: {
          animations: false,
          tabs: { mode: "off" },
          session: { sidebar: "hide", timestamps: layout },
          keybinds: { "opencode.settings": "f6" },
        },
        args: { sessionID },
        fetch: async (url) => {
          if (url.pathname === `/api/session/${sessionID}`)
            return json({
              data: {
                id: sessionID,
                title: "Timestamps",
                projectID: "project",
                location: { directory },
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                time: { created: sent, updated: completed },
              },
            })
          if (url.pathname === `/api/session/${sessionID}/message`)
            return json({ data: messages.toReversed(), cursor: {} })
          if (
            url.pathname === `/api/session/${sessionID}/inbox` ||
            url.pathname === `/api/session/${sessionID}/permission`
          )
            return json({ data: [] })
          return undefined
        },
      })
      await setup.ready
      const frame = await waitForHighlightedFrame(
        setup,
        (frame) => frame.includes("Timestamp response") && frame.includes("tok/s"),
      )
      const lines = frame.split("\n")
      const sentLine = lines.findIndex((line) => line.includes(Locale.time(sent)))
      const completionLine = lines.findIndex((line) => line.includes(Locale.time(completed)))
      const promptLine = lines.findIndex((line) => line.includes("Timestamp prompt"))
      const responseLine = lines.findIndex((line) => line.includes("Timestamp response"))
      expect(frame.split(Locale.time(sent))).toHaveLength(2)
      expect(frame.split(Locale.time(completed))).toHaveLength(2)
      if (layout === "footer") {
        expect(sentLine).toBeGreaterThan(promptLine)
        expect(completionLine).toBeGreaterThan(responseLine)
        expect(frame.indexOf(Locale.time(completed))).toBeLessThan(frame.indexOf("tok/s"))
      } else {
        expect(sentLine).toBeLessThan(promptLine)
        expect(completionLine).toBeLessThan(responseLine)
        if (layout === "divider") {
          const divider = (time: number) => `── ${Locale.time(time)} ──`
          expect(lines[sentLine].indexOf(divider(sent))).toBe(lines[completionLine].indexOf(divider(completed)))
          expect(lines[sentLine]).toContain(divider(sent))
          expect(lines[completionLine]).toContain(divider(completed))
          expect(promptLine - sentLine).toBeGreaterThan(1)
          expect(responseLine - completionLine).toBeGreaterThan(1)
          expect(frame).not.toContain(Locale.time(olderSent))
          expect(frame).not.toContain(Locale.time(olderCompleted))
          for (const [text, time] of [["Older prompt", olderSent], ["Old reply", olderCompleted]] as const) {
            const row = lines.findIndex((line) => line.includes(text))
            expect(row).toBeGreaterThanOrEqual(0)
            await setup.mockMouse.moveTo(lines[row].indexOf(text), row)
            const hovered = await setup.waitForFrame((frame) => frame.includes(Locale.time(time)))
            expect(hovered).not.toContain(divider(time))
            const hoverColumn = hovered.split("\n")[row].indexOf(Locale.time(time))
            expect(hoverColumn).toBeGreaterThanOrEqual(0)
            expect(Math.abs(hoverColumn - lines[sentLine].indexOf(Locale.time(sent)))).toBeLessThanOrEqual(1)
            expect(hovered.split("\n").findIndex((line) => line.includes(text))).toBe(row)
            expect(hovered.split("\n").findIndex((line) => line.includes("Timestamp response"))).toBe(responseLine)
            await setup.mockMouse.moveTo(hoverColumn, row)
            await setup.renderOnce()
            expect(setup.captureCharFrame().split("\n")[row]).toContain(Locale.time(time))
            await setup.mockMouse.moveTo(0, 0)
            await setup.waitForFrame((frame) => !frame.includes(Locale.time(time)))
          }
        } else {
          expect(lines[sentLine].indexOf(Locale.time(sent)) + Locale.time(sent).length).toBe(
            lines[completionLine].indexOf(Locale.time(completed)) + Locale.time(completed).length,
          )
          expect(lines[sentLine].indexOf(Locale.time(sent))).toBeGreaterThan(
            lines[promptLine].indexOf("Timestamp prompt"),
          )
          expect(lines[completionLine].indexOf(Locale.time(completed))).toBeGreaterThan(
            lines[responseLine].indexOf("Timestamp response"),
          )
        }
      }

      if (layout === "footer" && width === 100) {
        for (const next of ["header", "divider", "footer"] as const) {
          setup.mockInput.pressKey("F6")
          await setup.waitForFrame(
            (frame) => frame.includes("Settings") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
          )
          await setup.mockInput.typeText("Timestamp layout")
          await setup.waitForFrame((frame) => frame.includes("Timestamp layout"))
          setup.mockInput.pressArrow("right")
          await setup.waitForFrame(() => setup.config().session?.timestamps === next)
          setup.mockInput.pressEscape()
          const updated = await waitForHighlightedFrame(
            setup,
            (frame) =>
              !frame.includes("Settings") &&
              frame.includes("Timestamp response") &&
              frame.includes(Locale.time(completed)),
          )
          const position = updated.indexOf(Locale.time(completed))
          if (next === "footer") expect(position).toBeGreaterThan(updated.indexOf("Timestamp response"))
          else expect(position).toBeLessThan(updated.indexOf("Timestamp response"))
          expect(updated.includes(`── ${Locale.time(completed)} ──`)).toBe(next === "divider")
          expect(setup.config().session?.timestamps).toBe(next)
        }
      }
    },
  )
}
