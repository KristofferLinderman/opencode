import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Config } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"
import { AbsolutePath } from "@opencode/schema/schema"

it.live("returns ordered config entries for the requested directory", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-config-endpoint-")))
    const global = path.join(tmp.path, "global")
    const project = path.join(tmp.path, "project")
    const config = path.join(project, "opencode.json")
    yield* Effect.promise(() =>
      Promise.all([fs.mkdir(global, { recursive: true }), fs.mkdir(project, { recursive: true })]),
    )
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        JSON.stringify({
          permissions: [
            { action: "shell", resource: "*", effect: "ask" },
            { action: "shell", resource: "git status", effect: "allow" },
          ],
          mcp: { servers: { docs: { type: "remote", url: "https://example.com/mcp" } } },
        }),
      ),
    )
    const server = yield* startServer(global)
    const url = new URL("/api/config", server.base)
    url.searchParams.set("location[directory]", project)
    const response = yield* Effect.promise(() => fetch(url, { headers: server.headers }))
    const body: unknown = yield* Effect.promise(() => response.json())
    const entries = Schema.decodeUnknownSync(Schema.Array(Config.Entry))(body)

    expect(response.status).toBe(200)
    expect(Array.isArray(entries)).toBe(true)
    const document = entries.find(
      (entry): entry is Config.Document => entry.type === "document" && entry.path === config,
    )
    expect(document?.info.permissions).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git status", effect: "allow" },
    ])
    expect(document?.path).toBe(AbsolutePath.make(config))
    if (!Array.isArray(body)) throw new Error("Expected a config entry array")
    const raw = body.find((entry) => isRecord(entry) && entry["type"] === "document" && entry["path"] === config)
    if (!isRecord(raw) || !isRecord(raw["info"])) throw new Error("Expected a config document")
    expect(raw["info"]).not.toHaveProperty("default_agent")
    expect(raw["info"]).not.toHaveProperty("model")
    const mcp = raw["info"]["mcp"]
    if (!isRecord(mcp) || !isRecord(mcp["servers"]) || !isRecord(mcp["servers"]["docs"]))
      throw new Error("Expected an MCP server config")
    expect(mcp["servers"]["docs"]).not.toHaveProperty("headers")
    expect(mcp["servers"]["docs"]).not.toHaveProperty("oauth")
  }),
)

it.live("updates the global shell without replacing unrelated JSONC", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-config-shells-")))
    const global = path.join(tmp.path, "global")
    const config = path.join(global, "opencode.jsonc")
    yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
    yield* Effect.promise(() =>
      fs.writeFile(
        config,
        `{
  // keep this comment
  "model": "provider/model",
  "shell": "bash"
}
`,
      ),
    )
    const server = yield* startServer(global)
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/config", server.base), {
        method: "PATCH",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ shell: "/bin/zsh" }),
      }),
    )

    expect(response.status).toBe(204)
    const text = yield* Effect.promise(() => fs.readFile(config, "utf8"))
    expect(text).toContain("// keep this comment")
    expect(text).toContain('"model": "provider/model"')
    expect(text).toContain('"shell": "/bin/zsh"')

    const shells = yield* Effect.promise(() =>
      fetch(new URL("/api/config/shell", server.base), { headers: server.headers }),
    )
    expect(shells.status).toBe(200)
    expect(Array.isArray(yield* Effect.promise(() => shells.json()))).toBe(true)
  }),
)

it.live("inherits terminal themes and writes only to the nearest declared scope", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-theme-scope-")))
    const global = path.join(tmp.path, "global")
    const parent = path.join(tmp.path, "work")
    const child = path.join(parent, "repo")
    const nested = path.join(child, "src")
    const sibling = path.join(parent, "other")
    const outside = path.join(tmp.path, "work-other")
    const parentFile = path.join(parent, ".opencode", "opencode.json")
    const childFile = path.join(child, "opencode.jsonc")
    yield* Effect.promise(() =>
      Promise.all(
        [global, path.dirname(parentFile), nested, sibling, outside].map((dir) => fs.mkdir(dir, { recursive: true })),
      ),
    )
    const parentText = '{"theme":{"name":"flexoki","mode":"dark"}}'
    yield* Effect.promise(() =>
      Promise.all([
        fs.writeFile(parentFile, parentText),
        fs.writeFile(childFile, '{\n  // keep this comment\n  "theme": { "mode": "light" }\n}\n'),
        fs.writeFile(path.join(nested, "opencode.json"), '{"model":"provider/model"}'),
      ]),
    )
    const server = yield* startServer(global)
    function request(directory: string, patch?: { path: string; theme: Config.Theme }) {
      const url = new URL("/api/config/theme", server.base)
      url.searchParams.set("location[directory]", directory)
      return Effect.promise(() =>
        fetch(url, {
          method: patch ? "PATCH" : "GET",
          headers: { ...server.headers, "content-type": "application/json" },
          body: patch ? JSON.stringify(patch) : undefined,
        }),
      )
    }
    const inherited = yield* request(nested)
    expect(yield* Effect.promise(() => inherited.json())).toEqual({
      path: childFile,
      theme: { name: "flexoki", mode: "light" },
    })
    expect((yield* request(nested, { path: parentFile, theme: { name: "opencode" } })).status).toBe(409)
    const saved = yield* request(nested, { path: childFile, theme: { name: "opencode" } })
    expect(saved.status).toBe(200)
    expect(yield* Effect.promise(() => saved.json())).toEqual({
      path: childFile,
      theme: { name: "opencode", mode: "light" },
    })
    expect(yield* Effect.promise(() => fs.readFile(childFile, "utf8"))).toContain("// keep this comment")
    expect(yield* Effect.promise(() => fs.readFile(parentFile, "utf8"))).toBe(parentText)
    const shared = yield* request(sibling)
    expect(yield* Effect.promise(() => shared.json())).toEqual({
      path: parentFile,
      theme: { name: "flexoki", mode: "dark" },
    })
    const fallback = yield* request(outside)
    expect(yield* Effect.promise(() => fallback.json())).toEqual({ theme: {} })
  }),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
