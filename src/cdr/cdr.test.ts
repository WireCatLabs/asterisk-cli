import { describe, expect, it } from "vitest"
import { e164 } from "../phone.js"
import { callerName, callOf, isDialable, peerOf } from "./call.js"
import { csvColumns, csvLines, csvRows } from "./csv.js"
import { cdrRow } from "./record.js"

const base = Array.from({ length: 16 }, () => "")

describe("Master.csv columns", () => {
  it("tells loguniqueid, loguserfield and newcdrcolumns apart by the count", () => {
    expect(csvColumns(base)).toHaveLength(16)
    expect(csvColumns([...base, "1761901200.11"]).at(-1)).toBe("uniqueid")
    expect(csvColumns([...base, "vip"]).at(-1)).toBe("userfield")
    expect(csvColumns([...base, "1761901200.11", ""]).slice(16)).toEqual(["uniqueid", "userfield"])
    expect(csvColumns([...base, "", "1761901200.11", "1"]).slice(16)).toEqual(["peeraccount", "linkedid", "sequence"])
    expect(csvColumns([...base, "a", "b", "c", "d", "e"]).slice(16)).toEqual([
      "uniqueid",
      "userfield",
      "peeraccount",
      "linkedid",
      "sequence",
    ])
    expect(() => csvColumns([...base, "a", "b", "c", "d", "e", "f"])).toThrow(/cdr_csv_columns/)
  })

  it("reads quoted fields with doubled quotes, commas and CRLF", () => {
    expect([...csvLines('"a ""b""","c,d",3\r\n"e","",\n')]).toEqual([
      ['a "b"', "c,d", "3"],
      ["e", "", ""],
    ])
  })

  it("skips a line with another count, such as one still being written", () => {
    const line = `${base.map(() => '""').join(",")}\n`
    expect(csvRows(`${line}${line}"a","b"`)).toMatchObject({ skipped: 1, rows: [{}, {}] })
  })

  it("names each line's columns by its own count, so lines written after newcdrcolumns was turned on are read", () => {
    const old = `${base.map(() => '""').join(",")}\n`
    const newer = `${[...base.map(() => '""'), '"1761901200.11"', '""', '""', '"1761901200.11"', '"11"'].join(",")}\n`
    const read = csvRows(`${old}${newer}`)
    expect(read.skipped).toBe(0)
    expect(read.rows[1]).toMatchObject({ uniqueid: "1761901200.11", sequence: "11" })
    expect(() => csvRows('"a","b"\n')).toThrow(/cdr_csv_columns/)
  })
})

describe("one CDR row", () => {
  it("reads its times in the CDR's zone, and its end from the duration when there is none", () => {
    const row = cdrRow(
      { start: "2026-10-31 12:00:00", duration: "60", uniqueid: "1.1", sequence: "3" },
      "Europe/Moscow",
    )
    expect(new Date(row.start).toISOString()).toBe("2026-10-31T09:00:00.000Z")
    expect(row.end).toBe(row.start + 60_000)
    expect(row.id).toBe("1.1#3")
  })

  it("gives two rows of one uniqueid and no sequence two ids, and one row the same id every time", () => {
    const one = { start: "2026-10-31 12:00:00", uniqueid: "1.1", dst: "101" }
    const two = { ...one, dst: "103" }
    expect(cdrRow(one, "UTC").id).not.toBe(cdrRow(two, "UTC").id)
    expect(cdrRow(one, "UTC").id).toBe(cdrRow({ ...one }, "UTC").id)
  })

  it("treats MySQL's zero date as no answer, and refuses a row with no start", () => {
    expect(cdrRow({ start: "2026-10-31 12:00:00", answer: "0000-00-00 00:00:00" }, "UTC").answer).toBeNull()
    expect(() => cdrRow({ start: "" }, "UTC")).toThrow(/no start time/)
  })
})

describe("who called whom", () => {
  const row = (fields: Record<string, string>) => cdrRow({ start: "2026-10-31 12:00:00", ...fields }, "UTC")
  const extension = /^\d{2,5}$/

  it("finds the extension in the channel name, whatever number was shown outside", () => {
    expect(peerOf("PJSIP/101-0000002a")).toBe("101")
    expect(peerOf("Local/101@from-internal-00000001;1")).toBeNull()
    const outgoing = callOf(row({ src: "74950000000", channel: "PJSIP/102-1", dst: "89000000002" }), extension)
    expect(outgoing).toMatchObject({ direction: "outgoing", from: { number: "102", internal: true } })
  })

  it("calls a trunk call that no extension answered incoming, and guesses nothing without a sign", () => {
    expect(callOf(row({ src: "79000000003", dst: "74950000000", dcontext: "from-trunk" }), extension).direction).toBe(
      "incoming",
    )
    expect(callOf(row({ src: "79000000003", dst: "74950000000", dcontext: "custom" }), extension).direction).toBeNull()
  })

  it("keeps the outside caller of a queue leg, whose channel is a Local one", () => {
    const queued = row({ src: "+34600123456", channel: "Local/101@from-queue-00000001;2", dstchannel: "PJSIP/101-2" })
    expect(callOf(queued, extension)).toMatchObject({
      direction: "incoming",
      from: { number: "+34600123456", internal: false },
      to: { number: "101", internal: true },
    })
  })

  it("takes only something dialable for a person, never anonymous or s", () => {
    expect(["+34 600 123 456", "89000000002", "101"].map(isDialable)).toEqual([true, true, true])
    expect(["anonymous", "s", "Restricted", "", "12"].map(isDialable)).toEqual([false, false, false, false, false])
  })

  it("reads the caller's name, never a name that only repeats the number", () => {
    expect(callerName('"Ivan Testov" <79000000001>', "79000000001")).toBe("Ivan Testov")
    expect(callerName('"79000000001" <79000000001>', "79000000001")).toBeNull()
  })
})

describe("phone numbers", () => {
  it("writes an outside number as E.164 when its country is known, and nothing when it is not", () => {
    expect(e164("+34 600 000 000", null)).toBe("+34600000000")
    expect(e164("0034600000000", null)).toBe("+34600000000")
    expect(e164("89000000002", "ru")).toBe("+79000000002")
    expect(e164("89000000002", null)).toBeNull()
    expect(e164("101", "ru")).toBeNull()
  })
})
