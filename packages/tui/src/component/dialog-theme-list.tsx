import { DialogSelect, type DialogSelectRef } from "../ui/dialog-select"
import { useTheme, useThemes } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { createMemo, createSignal, onCleanup } from "solid-js"

/** `onClose` returns to the caller, e.g. Settings, instead of closing every dialog. */
export function DialogThemeList(props: { onClose?: () => void }) {
  const themes = useThemes()
  const theme = useTheme().surface("dialog")
  const options = createMemo(() =>
    Object.keys(themes.all())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({ title: value, value })),
  )
  const dialog = useDialog()
  const toast = useToast()
  const [saving, setSaving] = createSignal(false)
  let ref: DialogSelectRef<string>
  let disposed = false
  const initial = themes.selected

  onCleanup(() => {
    disposed = true
    themes.preview()
  })

  return (
    <DialogSelect
      title="Themes"
      searchInTitle
      titlePlaceholder="Search themes"
      options={options()}
      current={initial}
      onCancel={props.onClose}
      locked={saving()}
      footer={<text fg={theme.text.muted}>Save to: {themes.target()}</text>}
      onMove={(opt) => {
        themes.preview(opt.value)
      }}
      onSelect={async (opt) => {
        if (saving()) return
        setSaving(true)
        try {
          await themes.save({ name: opt.value })
          if (disposed) return
          if (props.onClose) return props.onClose()
          dialog.clear()
        } catch (cause) {
          toast.error(cause)
        } finally {
          setSaving(false)
        }
      }}
      ref={(r) => {
        ref = r
      }}
      onFilter={(query) => {
        if (query.length === 0) {
          themes.preview()
          return
        }

        const first = ref.filtered[0]
        if (first) themes.preview(first.value)
      }}
    />
  )
}
