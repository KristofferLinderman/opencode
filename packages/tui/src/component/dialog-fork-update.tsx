import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogBleed, DialogButtons, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import type { ReleaseNotes } from "../util/changelog"
import { errorMessage } from "../util/error"
import { getScrollAcceleration } from "../util/scroll"
import { Spinner } from "./spinner"

export type DialogForkUpdateProps = {
  current: string
  version: string
  notes: (signal: AbortSignal) => Promise<ReleaseNotes[]>
  skip: () => void
  prepare: () => void
}

/** Shows the release notes between the running fork and the stable release before preparing the fork update. */
export function DialogForkUpdate(props: DialogForkUpdateProps) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const maxHeight = createMemo(() => Math.max(6, Math.floor(dimensions().height * 0.6) - 4))
  const [active, setActive] = createSignal(1)
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  let scroll: ScrollBoxRenderable | undefined

  dialog.setCentered(true)

  const [notes] = createResource(() => props.notes(controller.signal))

  const buttons = [
    {
      label: "Skip",
      run: () => {
        props.skip()
        dialog.clear()
      },
    },
    { label: "Prepare update", run: () => props.prepare() },
  ]
  const move = (step: number) => setActive((value) => (value + step + buttons.length) % buttons.length)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm update action", group: "Dialog", run: () => buttons[active()]?.run() },
      { bind: "left", title: "Previous update action", group: "Dialog", run: () => move(-1) },
      { bind: "shift+tab", title: "Previous update action", group: "Dialog", run: () => move(-1) },
      { bind: "right", title: "Next update action", group: "Dialog", run: () => move(1) },
      { bind: "tab", title: "Next update action", group: "Dialog", run: () => move(1) },
      ...["up", "k"].map((bind) => ({ bind, title: "Scroll up", group: "Dialog", run: () => scroll?.scrollBy(-1) })),
      ...["down", "j"].map((bind) => ({ bind, title: "Scroll down", group: "Dialog", run: () => scroll?.scrollBy(1) })),
      { bind: "pageup", title: "Previous page", group: "Dialog", run: () => scroll?.scrollBy(-maxHeight()) },
      { bind: "pagedown", title: "Next page", group: "Dialog", run: () => scroll?.scrollBy(maxHeight()) },
    ],
  }))

  const inline = (value: string) => (
    <For each={value.replaceAll("**", "").split("`")}>
      {(part, index) => (index() % 2 === 1 ? <span style={{ fg: overlay.text.base }}>{part}</span> : part)}
    </For>
  )

  return (
    <DialogLayout
      header={<DialogHeader title={`Update available: ${props.current} → ${props.version}`} />}
      buttons={<DialogButtons buttons={buttons} active={active()} onActive={setActive} />}
    >
      <Switch>
        <Match when={notes.loading}>
          <Spinner shimmer={theme.text.base}>Loading changelog…</Spinner>
        </Match>

        <Match when={notes.error}>
          <text fg={theme.text.muted} wrapMode="word">
            Couldn't load the changelog: {errorMessage(notes.error)}
          </text>
        </Match>

        <Match when={notes()?.length === 0}>
          <text fg={theme.text.muted} wrapMode="word">
            No release notes found for {props.version}.
          </text>
        </Match>

        <Match when={notes()}>
          {(releases) => (
            <DialogBleed>
              <box backgroundColor={overlay.background.raised.high} paddingTop={1} paddingBottom={1}>
                <scrollbox
                  ref={(element: ScrollBoxRenderable) => (scroll = element)}
                  maxHeight={maxHeight()}
                  contentOptions={{ minHeight: 0 }}
                  backgroundColor={overlay.background.raised.high}
                  scrollbarOptions={{ visible: false }}
                  scrollAcceleration={getScrollAcceleration(config)}
                >
                  <box gap={1} paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET}>
                    <For each={releases()}>
                      {(release) => (
                        <box gap={1}>
                          <text attributes={TextAttributes.BOLD | TextAttributes.UNDERLINE} fg={overlay.text.base}>
                            v{release.version}
                          </text>

                          <For each={release.breaking}>
                            {(item) => (
                              <box>
                                <text attributes={TextAttributes.BOLD} fg={overlay.text.feedback.error.base}>
                                  Breaking: {item.title}
                                </text>

                                <text fg={overlay.text.muted} wrapMode="word">
                                  {inline(item.body)}
                                </text>
                              </box>
                            )}
                          </For>

                          <For each={release.features}>
                            {(item) => (
                              <box>
                                <text attributes={TextAttributes.BOLD} fg={overlay.text.base}>
                                  {item.title}
                                </text>

                                <text fg={overlay.text.muted} wrapMode="word">
                                  {inline(item.body)}
                                </text>
                              </box>
                            )}
                          </For>

                          <Show when={release.improved.length > 0}>
                            <box>
                              <text attributes={TextAttributes.BOLD} fg={overlay.text.base}>
                                Improved
                              </text>

                              <For each={release.improved}>
                                {(line) => (
                                  <text fg={overlay.text.muted} wrapMode="word">
                                    • {inline(line)}
                                  </text>
                                )}
                              </For>
                            </box>
                          </Show>

                          <Show when={release.fixed.length > 0}>
                            <box>
                              <text attributes={TextAttributes.BOLD} fg={overlay.text.base}>
                                Fixed
                              </text>

                              <For each={release.fixed}>
                                {(line) => (
                                  <text fg={overlay.text.muted} wrapMode="word">
                                    • {inline(line)}
                                  </text>
                                )}
                              </For>
                            </box>
                          </Show>
                        </box>
                      )}
                    </For>
                  </box>
                </scrollbox>
              </box>
            </DialogBleed>
          )}
        </Match>
      </Switch>
    </DialogLayout>
  )
}
