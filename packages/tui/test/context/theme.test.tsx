/** @jsxImportSource @opentui/solid */
import { CliRenderEvents, RGBA, type TerminalColors } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { RouteProvider, useRoute } from "../../src/context/route"
import { LocationThemeProvider, ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCodeTheme, getOpenCodeClassicTheme } from "../../src/theme"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { session } from "../fixture/local"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// OpenTUI emits palette again when an OSC reply arrives after its query ended at DA1.
test("the system theme follows a palette reply that arrives after the query", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "system" } }
  let theme!: ReturnType<typeof useTheme>
  let themes!: ReturnType<typeof useThemes>
  function Probe() {
    theme = useTheme()
    themes = useThemes()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{ get: async () => settings, update: async () => settings }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  const colors = (fg: string): TerminalColors => ({
    palette: [],
    defaultForeground: fg,
    defaultBackground: "#000000",
    cursorColor: null,
    mouseForeground: null,
    mouseBackground: null,
    tekForeground: null,
    tekBackground: null,
    highlightBackground: null,
    highlightForeground: null,
  })
  try {
    app.renderer.getPalette = async () => colors("#aaaaaa")
    app.renderer.start()
    await app.waitFor(() => themes !== undefined)
    themes.afterPaint()
    await app.waitFor(() => theme.text.base.equals(RGBA.fromHex("#aaaaaa")))
    app.renderer.emit(CliRenderEvents.PALETTE, colors("#123456"))
    expect(theme.text.base.equals(RGBA.fromHex("#123456"))).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test("names the new theme opencode and the previous one opencode-classic", async () => {
  await using temporary = await tmpdir()
  const settings: Info = { theme: { name: "opencode" } }
  let config!: ReturnType<typeof useConfig>
  let themes!: ReturnType<typeof useThemes>
  let theme!: ReturnType<typeof useTheme>
  function Probe() {
    config = useConfig()
    themes = useThemes()
    theme = useTheme()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (update) => {
            update(settings)
            return settings
          },
        }}
      >
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Probe />
        </ThemeProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)
    const newTheme = resolveThemeDocument(getOpenCodeTheme(), "dark").background.base
    const classic = resolveThemeDocument(getOpenCodeClassicTheme(), "dark").background.base
    expect(theme.background.base.equals(newTheme)).toBeTrue()
    await themes.save({ name: "opencode-classic" })
    expect(theme.background.base.equals(classic)).toBeTrue()
    await config.update((draft) => {
      draft.theme = { ...draft.theme, name: "opencode2" }
    })
    expect(themes.selected).toBe("opencode")
    expect(theme.background.base.equals(newTheme)).toBeTrue()

    // The names do not depend on the new designs experiment.
    await config.update((draft) => {
      draft.experimental = { "new-designs": false }
    })
    expect(theme.background.base.equals(newTheme)).toBeTrue()
    expect(themes.has("opencode-classic")).toBeTrue()
  } finally {
    app.renderer.destroy()
  }
})

test("switches theme and mode with the active scope and saves previews only when confirmed", async () => {
  const path = "/work/opencode.jsonc"
  const settings: Info = { theme: { name: "synthwave84", mode: "system" } }
  const writes: unknown[] = []
  const work = { path, theme: { name: "flexoki", mode: "light" } }
  const api = createApi(
    createFetch(async (url, request) => {
      if (url.pathname === "/api/session/ses_work")
        return json({ data: { ...session("ses_work"), location: { directory: "/work/subdir" } } })
      if (url.pathname !== "/api/config/theme") return
      if (url.searchParams.get("location[directory]") !== "/work/subdir") return json({ theme: {} })
      if (request.method === "PATCH") {
        const patch = await request.json()
        writes.push(patch)
        work.theme = { ...work.theme, ...patch.theme }
      }
      return json(work)
    }, createEventStream()).fetch,
  )
  let themes!: ReturnType<typeof useThemes>
  let route!: ReturnType<typeof useRoute>
  let data!: ReturnType<typeof useData>
  function Probe() {
    themes = useThemes()
    route = useRoute()
    data = useData()
    return null
  }
  const app = await testRender(() => (
    <TestTuiContexts>
      <ConfigProvider
        config={createTuiResolvedConfig(settings)}
        service={{
          get: async () => settings,
          update: async (change) => {
            change(settings)
            return settings
          },
        }}
      >
        <RouteProvider>
          <ClientProvider api={api}>
            <DataProvider directory="/personal">
              <ToastProvider>
                <LocationThemeProvider mode="dark" source={emptyThemeSource}>
                  <Probe />
                </LocationThemeProvider>
              </ToastProvider>
            </DataProvider>
          </ClientProvider>
        </RouteProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))

  try {
    app.renderer.start()
    await app.waitForFrame(() => themes !== undefined)
    expect(themes.selected).toBe("synthwave84")
    await data.session.sync("ses_work")
    route.navigate({ type: "session", sessionID: "ses_work" })
    await app.waitForFrame(() => themes.selected === "flexoki")
    expect(themes.mode()).toBe("light")
    expect(themes.target()).toBe(path)
    themes.preview("opencode")
    await app.waitForFrame(() => themes.selected === "opencode")
    expect(writes).toEqual([])
    themes.preview()
    await app.waitForFrame(() => themes.selected === "flexoki")
    await themes.save({ name: "opencode2" })
    expect(writes).toEqual([{ path, theme: { name: "opencode" } }])

    route.navigate({ type: "home" })
    await app.waitForFrame(() => themes.selected === "synthwave84" && themes.target() === "Global default")
    expect(themes.locked()).toBeFalse()
    expect(themes.target()).toBe("Global default")
    await themes.save({ name: "opencode" })
    expect(settings.theme?.name).toBe("opencode")
    expect(writes).toHaveLength(1)
    route.navigate({ type: "session", sessionID: "ses_work" })
    await app.waitForFrame(() => themes.target() === path)
    expect(themes.selected).toBe("opencode")
    expect(themes.mode()).toBe("light")
  } finally {
    app.renderer.destroy()
  }
})
