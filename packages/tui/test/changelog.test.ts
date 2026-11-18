import { expect, test } from "bun:test"
import { selectReleaseNotes } from "../src/util/changelog"

const release = (tag: string, feature = `Feature ${tag}`) => ({
  tag,
  url: `https://example.com/${tag}`,
  notes: {
    features: [{ title: feature, body: "Body" }],
    breaking: [],
    improved: [{ text: "Improved thing" }],
    fixed: [{ text: "Fixed thing" }, { nope: true }],
  },
})

const changelog = {
  releases: [release("v2.3.2"), release("v2.3.1"), release("v1.19.6"), release("v2.3.0"), release("v2.2.7"), null],
}

test("keeps releases after the current version up to the target, newest first", () => {
  const notes = selectReleaseNotes(changelog, "2.2.7", "2.3.1")
  expect(notes.map((item) => item.version)).toEqual(["2.3.1", "2.3.0"])
  expect(notes[0]).toEqual({
    version: "2.3.1",
    url: "https://example.com/v2.3.1",
    breaking: [],
    features: [{ title: "Feature v2.3.1", body: "Body" }],
    improved: ["Improved thing"],
    fixed: ["Fixed thing"],
  })
})

test("shows only the target when the running version is not stable", () => {
  expect(selectReleaseNotes(changelog, "local", "2.3.2").map((item) => item.version)).toEqual(["2.3.2"])
})

test("reads malformed changelogs as empty", () => {
  expect(selectReleaseNotes({ nope: 1 }, "2.2.7", "2.3.0")).toEqual([])
  expect(selectReleaseNotes(changelog, "2.2.7", "not-a-version")).toEqual([])
})
