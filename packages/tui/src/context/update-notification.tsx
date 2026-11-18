import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useEvent } from "./event"
import { errorMessage } from "../util/error"
import { useExit } from "./exit"
import { useEpilogue } from "./epilogue"
import { useDialog } from "../ui/dialog"
import { DialogUpdate } from "../component/dialog-update"
import { usePromptRef } from "./prompt"
import { useToast } from "../ui/toast"
import { DialogForkUpdate } from "../component/dialog-fork-update"
import { loadReleaseNotes, type ReleaseNotes } from "../util/changelog"
import { useTuiApp } from "./runtime"

type ClientNotice = { readonly type: "available" | "installed"; readonly version: string }
type Notice = ClientNotice & ({ readonly source: "client" } | { readonly source: "server"; readonly remote: boolean })
export type UpdateState =
  | ClientNotice
  | { readonly type: "installing"; readonly version: string }
  | { readonly type: "failed"; readonly message: string }

export type UpdateSource = {
  readonly prompt?: (version: string) => string
  /** Release notes shown before preparing a fork update. Defaults to the public changelog. */
  readonly changelog?: (input: { current: string; target: string; signal: AbortSignal }) => Promise<ReleaseNotes[]>
  readonly remote: boolean
  readonly subscribe: (notify: (notice: ClientNotice) => void) => () => void
  readonly check: (
    signal: AbortSignal,
    onInstall: (version: string) => void,
  ) => Promise<ClientNotice | { readonly type: "unavailable"; readonly message: string } | undefined>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const event = useEvent()
    const exit = useExit()
    const epilogue = useEpilogue()
    const dialog = useDialog()
    const log = useLog({ component: "update-notification" })
    const prompt = usePromptRef()
    const toast = useToast()
    const app = useTuiApp()
    const [state, setState] = createSignal<UpdateState>()
    const [notification, setNotification] = createSignal<Notice>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (notice: Notice) => {
      if (!props.updater) return
      // Every way out of the TUI after a local install tells the user to start the new version.
      if (notice.type === "installed" && !(notice.source === "server" && notice.remote))
        epilogue.updatedVersion(notice.version)
      if (
        notifications.versions.includes(`${notice.source}:${notice.version}`) ||
        (notice.source === "client" && notifications.versions.includes(notice.version))
      )
        return
      setNotification((current) => {
        if (notice.source === "server" && current?.source === "client") return current
        return notice
      })
    }

    const dismiss = () => {
      const current = notification()
      if (!current) return
      setNotification(undefined)
      // Only interactions with the automatic notification update its history.
      void markNotification((draft) => {
        draft.versions = [...draft.versions, `${current.source}:${current.version}`].slice(-100)
      }).catch((error) => log.error("failed to persist update notification", { error }))
    }

    const install = async () => {
      const updater = props.updater
      const current = state()
      if (!updater || !current || current.type !== "available") return
      setState({ type: "installing", version: current.version })
      await updater.apply(current.version).then(
        () => {
          epilogue.updatedVersion(current.version)
          setState({ type: "installed", version: current.version })
        },
        (error) => setState({ type: "failed", message: errorMessage(error) }),
      )
    }

    const check = async (signal: AbortSignal) => {
      const updater = props.updater
      if (!updater || state()?.type === "installing") return
      const result = await updater
        .check(signal, (version) => {
          if (!signal.aborted) setState({ type: "installing", version })
        })
        .finally(() => {
          if (state()?.type === "installing") setState(undefined)
        })
      if (signal.aborted) return
      if (result?.type === "unavailable") return result.message
      if (result?.type === "installed") epilogue.updatedVersion(result.version)
      setState(result)
    }

    const restart = () => {
      const current = state()
      if (current?.type !== "installed") return
      exit()
    }

    const open = async (origin: "manual" | "notification") => {
      if (!props.updater) return
      if (props.updater.prompt) {
        const updater = props.updater
        const current = notification()
        // Defer insertion until the slash command has finished handling its input event.
        const result = await (
          current?.source === "client" && current.type === "available"
            ? Promise.resolve(current)
            : updater.check(new AbortController().signal, () => {}).catch((error) => {
                toast.show({ variant: "error", message: errorMessage(error) })
                return null
              })
        )
        if (result === null) return
        if (!result || result.type !== "available") {
          toast.show({
            variant: "info",
            message: result?.type === "unavailable" ? result.message : "No stable OpenCode update available.",
          })
          return
        }
        const text = updater.prompt?.(result.version)
        if (!text) return
        const prepare = () => {
          const target = prompt.current
          if (!target) {
            toast.show({ variant: "warning", message: "Open a chat prompt before preparing the fork update." })
            return
          }
          dialog.clear()
          target.setMode("normal")
          target.set({
            ...target.current,
            text: [target.current.text, text].filter(Boolean).join("\n\n"),
          })
          target.focus()
        }
        const changelog = updater.changelog ?? loadReleaseNotes
        dialog.replace(() => (
          <DialogForkUpdate
            current={app.version}
            version={result.version}
            notes={(signal) => changelog({ current: app.version, target: result.version, signal })}
            skip={dismiss}
            prepare={prepare}
          />
        ))
        return
      }
      const current = notification()
      const known = current && (current.source === "client" || !current.remote) ? current : undefined
      if (origin === "notification" && !known) return
      const active = state()
      // The notification can predate an installation through /update.
      if (known && active?.type !== "installing" && !(active?.type === "installed" && active.version === known.version))
        setState({ type: known.type, version: known.version })
      const status = state()?.type
      dialog.replace(() => (
        <DialogUpdate
          check={status === undefined || status === "failed" ? check : undefined}
          state={state}
          skip={dismiss}
          install={install}
          restart={restart}
        />
      ))
    }

    onMount(() => {
      if (!props.updater) return
      onCleanup(props.updater.subscribe((notice) => notify({ ...notice, source: "client" })))
    })

    onCleanup(
      event.on("installation.update-available", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "available",
          version: event.data.version,
        }),
      ),
    )
    onCleanup(
      event.on("installation.updated", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "installed",
          version: event.data.version,
        }),
      ),
    )

    return {
      notification,
      dismiss,
      open: props.updater ? open : undefined,
    }
  },
})
