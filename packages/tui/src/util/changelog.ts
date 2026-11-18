const CHANGELOG_URL = "https://opencode.ai/changelog.json"

export type ReleaseFeature = { readonly title: string; readonly body: string }

export type ReleaseNotes = {
  readonly version: string
  readonly url?: string
  readonly breaking: ReadonlyArray<ReleaseFeature>
  readonly features: ReadonlyArray<ReleaseFeature>
  readonly improved: ReadonlyArray<string>
  readonly fixed: ReadonlyArray<string>
}

/** The notes of the stable releases after `current` up to and including `target`, newest first. */
export async function loadReleaseNotes(input: { current: string; target: string; signal: AbortSignal }) {
  const response = await fetch(CHANGELOG_URL, { signal: input.signal, headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error(`The changelog request failed with ${response.status}`)
  return selectReleaseNotes(await response.json(), input.current, input.target)
}

/** Reads the changelog leniently and keeps the releases in (current, target]; only `target` when `current` isn't stable. */
export function selectReleaseNotes(changelog: unknown, current: string, target: string): ReleaseNotes[] {
  const to = semver(target)
  if (!to) return []
  const from = semver(current)
  const list = Array.isArray(changelog) ? changelog : record(changelog)?.releases
  if (!Array.isArray(list)) return []
  return list
    .flatMap((value): ReleaseNotes[] => {
      const release = record(value)
      const version = text(release?.tag) ?? text(release?.name)
      const parsed = version ? semver(version) : undefined
      if (!release || !version || !parsed) return []
      if (compare(parsed, to) > 0) return []
      if (from ? compare(parsed, from) <= 0 : compare(parsed, to) !== 0) return []
      const notes = record(release.notes)
      return [
        {
          version: version.replace(/^v/, ""),
          url: text(release.url),
          breaking: features(notes?.breaking),
          features: features(notes?.features),
          improved: lines(notes?.improved),
          fixed: lines(notes?.fixed),
        },
      ]
    })
    .sort((a, b) => compare(semver(b.version)!, semver(a.version)!))
}

function features(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const entry = record(item)
    const title = text(entry?.title)
    const body = text(entry?.body) ?? text(entry?.text)
    if (title && body) return [{ title, body }]
    if (title || body) return [{ title: title ?? "", body: body ?? "" }]
    return []
  })
}

function lines(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const line = typeof item === "string" ? text(item) : text(record(item)?.text)
    return line ? [line] : []
  })
}

function record(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function semver(version: string) {
  return version
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/)
    ?.slice(1)
    .map(Number)
}

function compare(a: number[], b: number[]) {
  const index = a.findIndex((part, index) => part !== b[index])
  return index === -1 ? 0 : a[index] - b[index]
}
