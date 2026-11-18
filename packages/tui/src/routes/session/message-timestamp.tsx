import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"

type MessageTimestampProps = {
  time: number
  layout: "header" | "divider"
}

export const MessageTimestamp = (props: MessageTimestampProps) => {
  const theme = useTheme()

  return (
    <text
      fg={theme.text.muted}
      width="100%"
      textAlign={props.layout === "header" ? "right" : "center"}
      wrapMode="none"
      truncate
    >
      {props.layout === "divider" ? `── ${Locale.time(props.time)} ──` : Locale.time(props.time)}
    </text>
  )
}
