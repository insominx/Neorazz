import type { AskRecord, AskRecordMeta } from "@razzia/common/types/ask"
import { askRecordValidator } from "@razzia/common/validators/ask"
import {
  getConfigPath,
  readJsonFile,
  writeFileAtomic,
} from "@razzia/socket/services/config"
import { isSafeId, logSafe } from "@razzia/socket/utils/safe"
import fs from "fs"

// Each lecture room's questions live in `config/asks/<id>.json`, written
// through on every change: the host sleeps when idle and a restart loses live
// rooms, so nothing may wait for the room to close. The files are never
// served.
//
// Like `poll-store`, this module calls nothing from `services/config` while it
// loads, so the many tests that replace that module are unaffected.
//
// Nothing here logs a question's text or a name: a failure names the record
// by its id, which is random and says nothing about who asked.

const ASKS_DIR = "asks"

// A file system may answer "ABC" with abc.json (Windows and macOS ignore case,
// Linux does not). An id is the file's own name everywhere.
const hasFile = (dir: string, file: string): boolean => {
  try {
    return fs.readdirSync(dir).includes(file)
  } catch {
    return false
  }
}

const recordPath = (id: string) => getConfigPath(`${ASKS_DIR}/${id}.json`)

/**
 * Keeps a room's record. `false` says it could not be kept; the room offers it
 * again on its next change, its close or the server's shutdown.
 */
export const saveAskRecord = (record: AskRecord): boolean => {
  try {
    if (!isSafeId(record.id)) {
      throw new Error("Invalid ask record id")
    }

    // Through the same rules as a read, so only the known fields are written.
    // Its error is not passed on: a parser's message could quote the record.
    const parsed = askRecordValidator.safeParse(record)

    if (!parsed.success) {
      throw new Error("Invalid ask record")
    }

    fs.mkdirSync(getConfigPath(ASKS_DIR), { recursive: true })
    writeFileAtomic(recordPath(record.id), JSON.stringify(parsed.data, null, 2))

    return true
  } catch (error) {
    // A file system error names the path (a random id), never the content.
    console.error(
      `Failed to save ask record ${logSafe(record.id)}:`,
      error instanceof Error ? error.message : "unknown error",
    )

    return false
  }
}

const timeOf = (date: string): number => {
  const time = new Date(date).getTime()

  return Number.isNaN(time) ? 0 : time
}

/**
 * The records whose rooms are gone, as the inbox lists them: counts, never
 * text. `live` names the records that belong to rooms still open, which the
 * inbox shows with their room. Newest first. It never throws: a bad file is
 * skipped and logged by name.
 */
export const listAskRecordMeta = (
  live: ReadonlySet<string>,
): AskRecordMeta[] => {
  try {
    const dir = getConfigPath(ASKS_DIR)

    if (!fs.existsSync(dir)) {
      return []
    }

    return fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => {
        const id = file.slice(0, -".json".length)

        if (!isSafeId(id) || live.has(id)) {
          return []
        }

        try {
          const { gameSubject, date, asks } = getAskRecordById(id)

          return [
            {
              id,
              gameSubject,
              date,
              total: asks.length,
              waiting: asks.filter((ask) => ask.state === "new").length,
              answered: asks.filter((ask) => ask.state === "answered").length,
            },
          ]
        } catch {
          console.warn(`Unreadable ask record ${logSafe(file)}`)

          return []
        }
      })
      .sort((a, b) => timeOf(b.date) - timeOf(a.date))
  } catch {
    console.error("Failed to list the ask records")

    return []
  }
}

const readOrNull = (id: string): AskRecord | null => {
  try {
    return getAskRecordById(id)
  } catch {
    return null
  }
}

export type AskFileOutcome = "accepted" | "notFound" | "invalid" | "failed"

/**
 * Changes an earlier record on disk: reads it, hands it to `edit`, and writes
 * what comes back. `edit` answers an outcome instead when it changes nothing
 * (an ask that is not there). A record that cannot be read is `notFound`; one
 * that cannot be written is `failed` and stays as it was.
 */
export const editAskRecord = (
  id: string,
  edit: (_record: AskRecord) => AskRecord | AskFileOutcome,
): AskFileOutcome => {
  const record = readOrNull(id)

  if (!record) {
    return "notFound"
  }

  const edited = edit(record)

  if (typeof edited === "string") {
    return edited
  }

  return saveAskRecord(edited) ? "accepted" : "failed"
}

/** Removes an earlier record's file. */
export const deleteAskRecord = (id: string): AskFileOutcome => {
  if (!isSafeId(id) || !hasFile(getConfigPath(ASKS_DIR), `${id}.json`)) {
    return "notFound"
  }

  try {
    fs.unlinkSync(recordPath(id))

    return "accepted"
  } catch (error) {
    console.error(
      `Failed to delete ask record ${logSafe(id)}:`,
      error instanceof Error ? error.message : "unknown error",
    )

    return "failed"
  }
}

/** One record by id. Throws when the id is unsafe, or the file is missing or invalid. */
export const getAskRecordById = (id: string): AskRecord => {
  if (!isSafeId(id) || !hasFile(getConfigPath(ASKS_DIR), `${id}.json`)) {
    throw new Error(`Ask record ${logSafe(id)} not found`)
  }

  const result = askRecordValidator.safeParse(readJsonFile(recordPath(id)))

  if (!result.success) {
    throw new Error(`Invalid ask record ${logSafe(id)}`)
  }

  // The id is the file's name: that is what get and delete resolve.
  return { ...result.data, id }
}
