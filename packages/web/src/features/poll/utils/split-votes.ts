import type { TFunction } from "i18next"

// Stands in for the number when the vote line is asked for its word order: a
// private-use character, which no translation writes.
const NUMBER_MARK = ""

/**
 * The vote line ("12 votes") split around its number, so the rings can leave
 * the number in every language's word order. The split is where the
 * translation itself puts `{{count}}`, kept only if it rebuilds the line
 * exactly, so digits in the words never mislead it; otherwise it is the first
 * place the digits appear. A translation that writes no number keeps the whole
 * line as the rings' source.
 */
export const splitVotes = (t: TFunction, total: number) => {
  const text = t("poll:votes", { count: total })
  const number = String(total)
  const parts = t("poll:votes", {
    count: total,
    replace: { count: NUMBER_MARK },
  }).split(NUMBER_MARK)

  if (parts.length === 2 && `${parts[0]}${number}${parts[1]}` === text) {
    return { before: parts[0], number, after: parts[1] }
  }

  const at = text.indexOf(number)

  return at < 0
    ? { before: "", number: text, after: "" }
    : {
        before: text.slice(0, at),
        number,
        after: text.slice(at + number.length),
      }
}
