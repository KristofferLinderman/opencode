import { useTheme, useThemes } from "../../context/theme"
import { Locale } from "../../util/locale"

type MessageTimestampProps = {
  time: number
  layout: "header" | "divider"
}

export const HoverTimestamp = (props: { time: number; top?: number }) => {
  const theme = useTheme()
  const { mode } = useThemes()

  return (
    <box position="absolute" top={props.top ?? 0} left={0} right={0} zIndex={1} alignItems="center">
      <box paddingX={1} backgroundColor={mode() === "dark" ? theme.background.raised.high : theme.text.base}>
        <text fg={mode() === "dark" ? theme.text.base : theme.background.base} wrapMode="none">
          {Locale.time(props.time)}
        </text>
      </box>
    </box>
  )
}

export const MessageTimestamp = (props: MessageTimestampProps) => {
  const theme = useTheme()

  return (
    <text
      fg={theme.text.muted}
      width="100%"
      textAlign={props.layout === "header" ? "right" : "center"}
      marginBottom={props.layout === "divider" ? 1 : 0}
      wrapMode="none"
      truncate
    >
      {props.layout === "divider" ? `── ${Locale.time(props.time)} ──` : Locale.time(props.time)}
    </text>
  )
}
