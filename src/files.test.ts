import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { cdrRow } from "./cdr/record.js"
import { localFiles } from "./files.js"
import { DEFAULT_PATTERNS, recordingFinder } from "./recordings.js"

const folder = () => mkdtempSync(join(tmpdir(), "asterisk-files-"))

const written = (path: string, bytes = "RIFF") => {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, bytes)
  const hourAgo = new Date(Date.now() - 3_600_000)
  utimesSync(path, hourAgo, hourAgo)
  return path
}

it("local files answer nothing for a missing file, folder or a folder given as a file, and never quote a path", async () => {
  const root = folder()
  const files = localFiles()
  expect(await files.stat(join(root, "nope.wav"))).toBeNull()
  expect(await files.stat(root)).toBeNull()
  expect(await files.list(join(root, "nope"))).toEqual([])
  await expect(files.read(join(root, "nope.wav"), 10)).rejects.toMatchObject({
    code: "not_found",
    details: { reason: "file.missing" },
  })
  const big = written(join(root, "big.wav"), "x".repeat(2 * 1024 * 1024))
  const refused = files.read(big, 1024 * 1024)
  await expect(refused).rejects.toMatchObject({ details: { reason: "file.too-large" } })
  await expect(refused).rejects.not.toThrow(root)
  await files.close()
})

it("finds FreePBX's recordingfile in the date folder, then in the folder itself, else by the uniqueid", async () => {
  const root = folder()
  written(join(root, "2026/10/31/q-200-79000000001-20261031-120000-1761901200.11.wav"))
  written(join(root, "external-102-89000000002-1761904800.21.mp3"))
  written(join(root, "2026/10/31/1761908400.31.gsm"))
  const find = recordingFinder(localFiles(), { root, patterns: DEFAULT_PATTERNS, zone: "UTC", now: Date.now })
  const row = (uniqueid: string, recordingfile: string) =>
    cdrRow({ start: "2026-10-31 12:00:00", uniqueid, sequence: "1", recordingfile }, "UTC")
  expect((await find(row("1761901200.11", "q-200-79000000001-20261031-120000-1761901200.11.wav")))?.mime).toBe(
    "audio/wav",
  )
  expect((await find(row("1761904800.21", "external-102-89000000002-1761904800.21.mp3")))?.mime).toBe("audio/mpeg")
  expect((await find(row("1761908400.31", "")))?.mime).toBe("audio/x-gsm")
  expect(await find(row("1761999999.99", "missing.wav"))).toBeNull()
})
