import { Config } from "@opencode/core/config"
import { ShellSelect } from "@opencode/core/shell/select"
import { ThemeScopeChangedError } from "@opencode/schema/config"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  handlers
    .handle("config.get", () => Config.Service.use((config) => config.entries()))
    .handle("config.theme", () => Config.Service.use((config) => config.theme?.() ?? Effect.succeed({ theme: {} })))
    .handle(
      "config.updateTheme",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        const scope = yield* config.updateTheme?.(ctx.payload).pipe(Effect.orDie) ?? Effect.succeed(undefined)
        if (!scope)
          return yield* new ThemeScopeChangedError({ message: "Theme scope changed. Reopen the theme picker." })
        return scope
      }),
    )
    .handle(
      "config.update",
      Effect.fn(function* (ctx) {
        const config = yield* Config.Service
        if (!config.update) return yield* Effect.die(new Error("Config updates are unavailable"))
        return yield* config.update(ctx.payload).pipe(Effect.orDie)
      }),
    )
    .handle(
      "config.shells",
      Effect.fn(function* () {
        const shell = yield* ShellSelect.Service
        if (!shell.list) return yield* Effect.die(new Error("Shell discovery is unavailable"))
        return yield* shell.list()
      }),
    ),
)
