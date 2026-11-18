import type { RGBA } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "../context/theme"

// Two pixels per cell (top and bottom half), the same grid as the logo, so the panda stands as tall as the wordmark.
// E: ears, W: face, K: eye patches and nose, .: empty.
const PIXELS = [
  "EE.......EE",
  "EEWWWWWWWEE",
  ".WWWWWWWWW.",
  ".WKKWWWKKW.",
  ".WKKWWWKKW.",
  ".WWWWKWWWW.",
  "..WWWWWWW..",
  "...........",
]

export function Panda() {
  const theme = useTheme()
  const color = (pixel: string): RGBA | undefined =>
    pixel === "E" ? theme.text.muted : pixel === "W" ? theme.text.base : pixel === "K" ? theme.background.base : undefined

  const cells = (top: string, bottom: string) =>
    Array.from(top).map((pixel, index) => {
      const upper = color(pixel)
      const lower = color(bottom[index])
      if (!upper && !lower) return <text selectable={false}> </text>
      if (!upper)
        return (
          <text fg={lower} selectable={false}>
            ▄
          </text>
        )
      return (
        <text fg={upper} bg={lower} selectable={false}>
          {pixel === bottom[index] ? "█" : "▀"}
        </text>
      )
    })

  return (
    <box>
      <For each={[0, 2, 4, 6]}>
        {(row) => <box flexDirection="row">{cells(PIXELS[row], PIXELS[row + 1])}</box>}
      </For>
    </box>
  )
}
