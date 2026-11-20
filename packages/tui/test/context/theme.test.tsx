/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { resolveThemeDocument } from "@opencode/theme/tui"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { RouteProvider, useRoute } from "../../src/context/route"
import { LocationThemeProvider, ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCode2Theme, getOpenCodeTheme } from "../../src/theme"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { session } from "../fixture/local"
import { createApi, createEventStream, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

test("offers opencode2 only while the new designs experiment is enabled", async () => {
  await using temporary = await tmpdir()
  const settings: Info = {}
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
    expect(themes.has("opencode2")).toBeFalse()
    expect(Object.keys(themes.all())).not.toContain("opencode2")

    await config.update((draft) => {
      draft.experimental = { "new-designs": true }
    })
    expect(themes.has("opencode2")).toBeTrue()
    await themes.save({ name: "opencode2" })
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCode2Theme(), "dark").background.base)).toBeTrue()

    await config.update((draft) => {
      draft.experimental = { "new-designs": false }
    })
    expect(themes.has("opencode2")).toBeFalse()
    expect(theme.background.base.equals(resolveThemeDocument(getOpenCodeTheme(), "dark").background.base)).toBeTrue()
    expect(themes.selected).toBe("opencode2")
    expect(settings.theme?.name).toBe("opencode2")
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
    await themes.save({ name: "opencode" })
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
