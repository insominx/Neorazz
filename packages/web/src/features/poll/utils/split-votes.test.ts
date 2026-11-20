import { splitVotes } from "@razzia/web/features/poll/utils/split-votes"
import { createInstance, type TFunction } from "i18next"
import { describe, expect, it } from "vitest"

// A real i18next with one language's vote line, so plurals and interpolation
// (including `replace`) behave as in the app.
const translate = async (one: string, other: string): Promise<TFunction> => {
  const i18n = createInstance()

  await i18n.init({
    lng: "en",
    ns: ["poll"],
    resources: {
      en: { poll: { votes_one: one, votes_other: other } },
    },
    interpolation: { escapeValue: false },
  })

  return i18n.t.bind(i18n) as TFunction
}

describe("splitVotes", () => {
  it("splits a line that starts with its number, singular and plural", async () => {
    const t = await translate("{{count}} vote", "{{count}} votes")

    expect(splitVotes(t, 1)).toEqual({
      before: "",
      number: "1",
      after: " vote",
    })
    expect(splitVotes(t, 12)).toEqual({
      before: "",
      number: "12",
      after: " votes",
    })
  })

  it("splits a line with its number mid-way", async () => {
    const t = await translate(
      "so far {{count}} vote in",
      "so far {{count}} votes in",
    )

    expect(splitVotes(t, 3)).toEqual({
      before: "so far ",
      number: "3",
      after: " votes in",
    })
  })

  it("finds the number where the translation puts it, not where the digits first appear", async () => {
    const t = await translate(
      "1 poll: {{count}} vote",
      "1 poll: {{count}} votes",
    )

    expect(splitVotes(t, 1)).toEqual({
      before: "1 poll: ",
      number: "1",
      after: " vote",
    })
  })

  it("keeps the whole line when the translation writes no number", async () => {
    const t = await translate("One vote", "Votes")

    expect(splitVotes(t, 1)).toEqual({
      before: "",
      number: "One vote",
      after: "",
    })
  })
})
