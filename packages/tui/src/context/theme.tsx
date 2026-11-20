import { CliRenderEvents, SyntaxStyle, type TerminalColors } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import type { ConfigTheme, ConfigThemeScope } from "@opencode/client"
import {
  generateSyntax,
  resolveThemeDocument,
  themeModes,
  type ResolvedTheme,
  type SurfaceName,
} from "@opencode/theme/tui"
import {
  allThemes,
  getOpenCode2Theme,
  hasTheme,
  parseTheme,
  setCustomThemes,
  setSystemTheme,
  subscribeThemes,
  type ThemeDocumentSource,
} from "../theme"
import { generateSystem, terminalMode } from "../theme/system"
import { discoverThemes } from "../theme/discovery"
import { createComponentTheme, type ComponentTheme } from "../theme/component"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  type Accessor,
  type ParentProps,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useConfig, useNewDesigns } from "../config"
import { useStorageOptional } from "./storage"
import { DevTools } from "../devtools"
import { configDirectories } from "../util/config-directories"
import { useToast } from "../ui/toast"
import { useClient } from "./client"
import { useData } from "./data"
import { useRoute } from "./route"

const themePerformance = DevTools.register({ id: "theme-performance", title: "Theme performance" })
export type ThemeError = { name: string; error: Error }
type ThemeErrorHandler = (event: ThemeError) => void

function createThemeErrors() {
  let handler: ThemeErrorHandler | undefined
  let pending: ThemeError | undefined

  return {
    emit(name: string, cause: unknown) {
      const event = { name, error: cause instanceof Error ? cause : new Error(String(cause)) }
      if (handler) {
        handler(event)
        return
      }
      pending = event
    },
    onError(next: ThemeErrorHandler) {
      handler = next
      if (pending) {
        next(pending)
        pending = undefined
      }
      return () => {
        if (handler === next) handler = undefined
      }
    },
  }
}

const themeErrors = createThemeErrors()

export type ThemeSource = Readonly<{
  discover(directory: string): Promise<Record<string, unknown>>
  subscribeRefresh?(refresh: () => void): () => void
}>

type ThemeScopes = {
  directory: Accessor<string>
  current: Accessor<ConfigThemeScope | undefined>
  update: (path: string, theme: ConfigTheme) => Promise<void>
  error: (cause: unknown) => void
}

export const createThemeSource = (config: string): ThemeSource => ({
  async discover(directory) {
    return discoverThemes(configDirectories(config, directory))
  },
  subscribeRefresh(refresh) {
    process.on("SIGUSR2", refresh)
    return () => process.off("SIGUSR2", refresh)
  },
})

const THEME_REFRESH_DELAYS = [250, 1000] as const

type State = {
  mode: "dark" | "light"
  lock: "dark" | "light" | undefined
  active: string
  ready: boolean
}

type Themes = {
  current: ComponentTheme
  currentTokens: Accessor<ResolvedTheme>
  readonly selected: string
  all: typeof allThemes
  has: typeof hasTheme
  currentSyntax: Accessor<SyntaxStyle>
  mode: Accessor<"dark" | "light">
  modes: Accessor<readonly ("dark" | "light")[]>
  supports(mode: "dark" | "light"): boolean
  locked: Accessor<boolean>
  lock(): void
  unlock(): void
  setMode(mode?: "dark" | "light", persist?: boolean): boolean
  preference(): ConfigTheme
  target(): string
  preview(theme?: string): void
  save(theme: ConfigTheme): Promise<void>
  afterPaint(): void
  onError(handler: ThemeErrorHandler): () => void
  readonly ready: boolean
}

type ThemeContextValue = {
  current: ComponentTheme
  themes: Themes
  readonly ready: boolean
}

const [store, setStore] = createStore<State>({
  mode: "dark",
  lock: undefined,
  active: "opencode",
  ready: false,
})
const [themeSources, setThemeSources] = createSignal(allThemes())

subscribeThemes(setThemeSources)

const themeContext = createSimpleContext({
  name: "Theme",
  init: (props: { mode: "dark" | "light"; source: ThemeSource; scopes?: ThemeScopes }): ThemeContextValue => {
    const renderer = useRenderer()
    const configState = useConfig()
    const newDesigns = useNewDesigns()
    const config = configState.data
    const themes = props.source
    const directory = props.scopes?.directory ?? (() => process.cwd())
    const scoped = () => props.scopes?.current()
    const preference = createMemo(() => ({ ...config.theme, ...scoped()?.theme }))
    const [preview, setPreview] = createSignal<string>()
    const cache = useStorageOptional()?.store<{ colors?: TerminalColors }>("system-theme", { initial: {} })

    setStore(
      produce((draft) => {
        const lock = config.theme?.mode === "dark" || config.theme?.mode === "light" ? config.theme.mode : undefined
        const mode = lock ?? renderer.themeMode ?? props.mode
        draft.mode = mode
        draft.lock = lock
        draft.active = config.theme?.name ?? "opencode"
        draft.ready = false
      }),
    )

    createEffect(() => {
      const theme = preview() ?? preference().name ?? "opencode"
      setStore("active", theme)
      if (theme === "system") refreshPalette()
    })

    createEffect(() => {
      const mode = preference().mode
      if (mode === "dark" || mode === "light") {
        pin(mode, false)
        return
      }
      if (store.lock !== undefined) free(false)
    })

    let discovery = 0
    function syncCustomThemes(directory: string) {
      const request = ++discovery
      return themes
        .discover(directory)
        .then((themes) => {
          if (request !== discovery) return
          setCustomThemes(themes)
        })
        .catch(() => {
          if (request === discovery) setCustomThemes({})
        })
    }

    createEffect(() => {
      // Terminal palette queries serialize with frame output. First paint uses the cached palette or built-in fallback.
      const discover = syncCustomThemes(directory())
      const request = discovery
      void discover.finally(() => {
        if (request !== discovery) return
        tokens()
        setStore("ready", true)
      })
    })

    const cachedPalette = cache?.[0].colors
    let palette = usablePalette(cachedPalette) ? cachedPalette : undefined
    const applyPalette = () => {
      if (palette) setSystemTheme(generateSystem(palette, store.mode))
    }
    if (palette) {
      const mode = store.lock ?? renderer.themeMode ?? terminalMode(palette) ?? store.mode
      if (store.mode !== mode) setStore("mode", mode)
      applyPalette()
    } else setSystemTheme(undefined)

    let canProbe = false
    let probing = false
    let queued = false
    let disposed = false
    function refreshPalette() {
      if (store.active !== "system") return
      queued = true
      if (!canProbe || probing || disposed) return

      queued = false
      probing = true
      // Clearing does not cancel a query already owned by the renderer. Share it, then run one fresh query.
      const retry = renderer.paletteDetectionStatus === "detecting"
      renderer.clearPaletteCache()
      void renderer
        .getPalette({ size: 16 })
        .then((colors) => {
          if (disposed || !usablePalette(colors)) return
          palette = colors
          const mode = store.lock ?? terminalMode(colors) ?? store.mode
          if (store.mode !== mode) setStore("mode", mode)
          applyPalette()
          void cache?.[1]((draft) => {
            draft.colors = colors
          }).catch(() => {})
        })
        .catch(() => {})
        .finally(() => {
          probing = false
          if (disposed || (!retry && !queued)) return
          refreshPalette()
        })
    }

    function afterPaint() {
      canProbe = true
      refreshPalette()
    }

    function apply(mode: "dark" | "light") {
      if (store.mode !== mode) {
        setStore("mode", mode)
        applyPalette()
      }
      refreshPalette()
    }

    async function save(theme: ConfigTheme) {
      const current = scoped()
      if (props.scopes && !current) throw new Error("Theme scope is unavailable. Try again.")
      if (current?.path && props.scopes) return props.scopes.update(current.path, theme)
      await configState.update((draft) => {
        draft.theme = { ...draft.theme, ...theme }
      })
    }

    function pin(mode: "dark" | "light" = store.mode, persist = true) {
      if (persist) {
        void save({ mode }).catch(props.scopes?.error ?? (() => {}))
        return
      }
      setStore("lock", mode)
      apply(mode)
    }

    function free(persist = true) {
      if (persist) {
        void save({ mode: "system" }).catch(props.scopes?.error ?? (() => {}))
        return
      }
      setStore("lock", undefined)
      apply(renderer.themeMode ?? (palette && terminalMode(palette)) ?? props.mode)
    }

    const handleMode = (mode: "dark" | "light") => {
      if (store.lock) return
      apply(mode)
    }
    renderer.on(CliRenderEvents.THEME_MODE, handleMode)

    const handleThemeNotification = (sequence: string) => {
      if (sequence !== "\x1b[?997;1n" && sequence !== "\x1b[?997;2n") return false
      queueMicrotask(refreshPalette)
      return false
    }
    renderer.prependInputHandler(handleThemeNotification)

    let themeRefreshTimeouts: ReturnType<typeof setTimeout>[] = []
    const refreshThemes = () => {
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts = THEME_REFRESH_DELAYS.map((delay) =>
        setTimeout(() => {
          refreshPalette()
          if (delay === THEME_REFRESH_DELAYS[THEME_REFRESH_DELAYS.length - 1]) void syncCustomThemes(directory())
        }, delay),
      )
    }
    const unsubscribeRefresh = themes.subscribeRefresh?.(refreshThemes)

    onCleanup(() => {
      disposed = true
      discovery++
      renderer.off(CliRenderEvents.THEME_MODE, handleMode)
      renderer.removeInputHandler(handleThemeNotification)
      unsubscribeRefresh?.()
      for (const timeout of themeRefreshTimeouts) clearTimeout(timeout)
      themeRefreshTimeouts.length = 0
    })

    const available = createMemo(
      (): Record<string, ThemeDocumentSource> =>
        newDesigns() ? { opencode2: getOpenCode2Theme(), ...themeSources() } : themeSources(),
    )
    const has = (name: string) => Boolean(name) && available()[name] !== undefined
    const activeName = () =>
      has(store.active) ? store.active : config.theme?.name && has(config.theme.name) ? config.theme.name : "opencode"

    const initStarted = performance.now()
    const selected = createMemo(() => {
      const sources = available()
      const name = activeName()
      try {
        return loadTheme(sources[name], name, store.mode, newDesigns())
      } catch (error) {
        if (name === "opencode") throw error
        themeErrors.emit(name, error)
        setStore("active", "opencode")
        return loadTheme(sources.opencode, "opencode", store.mode, newDesigns())
      }
    })
    const modes = () => selected().modes
    const mode = () => selected().mode
    const tokens = () => selected().theme
    tokens()
    themePerformance.set("Init", `${(performance.now() - initStarted).toFixed(2)} ms`)
    const current = createComponentTheme(tokens)

    createEffect(() => renderer.setBackgroundColor(tokens().background.base))

    const currentSyntax = createSyntaxStyleMemo(() => generateSyntax(tokens(), renderer.nativeScene))
    const service: Themes = {
      current,
      currentTokens: tokens,
      currentSyntax,
      get selected() {
        return store.active
      },
      all: available,
      has,
      mode,
      modes,
      supports: (requested) => modes().includes(requested),
      locked: () => store.lock !== undefined,
      lock: () => pin(mode()),
      unlock: free,
      setMode(requested = mode(), persist = true) {
        if (!modes().includes(requested)) return false
        pin(requested, persist)
        return true
      },
      preference,
      target: () => scoped()?.path ?? (!props.scopes || scoped() ? "Global default" : "Theme scope unavailable"),
      preview: setPreview,
      save,
      afterPaint,
      onError: themeErrors.onError,
      get ready() {
        return store.ready
      },
    }
    return {
      current,
      themes: service,
      get ready() {
        return service.ready
      },
    }
  },
})

export function useThemes() {
  return themeContext.use().themes
}
export function useTheme(): ComponentTheme {
  return themeContext.use().current
}
export const ThemeProvider = themeContext.provider

export function LocationThemeProvider(props: ParentProps<{ mode: "dark" | "light"; source: ThemeSource }>) {
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const toast = useToast()
  const directory = createMemo(
    () =>
      (route.data.type === "session" ? data.session.get(route.data.sessionID)?.location.directory : undefined) ??
      data.location.default().directory,
  )
  const [scope, { mutate, refetch }] = createResource(directory, async (directory) => ({
    directory,
    scope: await client.api.config.theme({ location: { directory } }).catch(() => undefined),
  }))
  onCleanup(
    client.event.on("config.updated", (event) => {
      if (!event.location || event.location.directory === directory()) void refetch()
    }),
  )
  onCleanup(client.event.on("server.connected", () => void refetch()))
  const scopes: ThemeScopes = {
    directory,
    current: () => {
      const current = scope.latest
      return current?.directory === directory() ? current?.scope : undefined
    },
    async update(path, theme) {
      const active = directory()
      const updated = await client.api.config.updateTheme({ location: { directory: active }, path, theme })
      if (directory() !== active) return
      mutate({ directory: active, scope: updated })
      await refetch()
    },
    error: toast.error,
  }
  return (
    <ThemeProvider mode={props.mode} source={props.source} scopes={scopes}>
      {props.children}
    </ThemeProvider>
  )
}

/** Switches the ambient theme surface without remounting children; undefined inherits the enclosing view. */
export function ThemeContextProvider(props: ParentProps<{ context: SurfaceName | undefined }>) {
  const value = themeContext.use()
  const current = createComponentTheme(() => {
    const name = props.context
    return name ? value.themes.currentTokens().surface(name) : value.current
  })
  return (
    <themeContext.context.Provider value={{ current, themes: value.themes, ready: value.ready }}>
      {props.children}
    </themeContext.context.Provider>
  )
}

function usablePalette(colors: TerminalColors | undefined): colors is TerminalColors {
  return Boolean(
    colors && (colors.defaultBackground ?? colors.palette[0]) && (colors.defaultForeground ?? colors.palette[7]),
  )
}

function loadTheme(source: ThemeDocumentSource, name: string, requested: "dark" | "light", newDesigns: boolean) {
  const document = parseTheme(source, name, { newDesigns })
  const modes = themeModes(document)
  const mode = modes.includes(requested) ? requested : (modes[0] ?? requested)
  return { modes, mode, theme: resolveThemeDocument(document, mode) }
}

export function createSyntaxStyleMemo(factory: () => SyntaxStyle) {
  const renderer = useRenderer()
  const retained = new Set<SyntaxStyle>()
  let current: SyntaxStyle | undefined

  const release = (style: SyntaxStyle) => {
    retained.add(style)
    void renderer
      .idle()
      .catch(() => {})
      .finally(() => {
        if (!retained.delete(style)) return
        style.destroy()
      })
  }

  onCleanup(() => {
    if (current) release(current)
  })

  return createMemo(() => {
    const previous = current
    current = factory()
    if (previous) release(previous)
    return current
  })
}
