import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import clsx from "clsx"
import { MessageCircleQuestionMark } from "lucide-react"
import { useTranslation } from "react-i18next"

/**
 * The question button in a phone's footer. It is always laid out, and hidden
 * (`visibility`) while it is not offered, so the footer is the same height on
 * every screen and nothing moves as a question starts.
 */
const AskButton = () => {
  const offered = useAskStore((state) => state.offered)
  const sheetOpen = useAskStore((state) => state.sheetOpen)
  const { t } = useTranslation()

  return (
    <button
      type="button"
      data-ask-button
      aria-haspopup="dialog"
      aria-expanded={offered ? sheetOpen : undefined}
      aria-hidden={offered ? undefined : true}
      tabIndex={offered ? undefined : -1}
      disabled={!offered}
      onClick={() => {
        useAskStore.getState().openSheet()
      }}
      className={clsx(
        "bg-surface border-border text-text-primary focus-visible:outline-brand ease-calm flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-base font-bold transition-transform focus-visible:outline-2 active:scale-[0.97]",
        !offered && "invisible",
      )}
    >
      <MessageCircleQuestionMark aria-hidden className="text-brand size-5" />
      {t("ask:button")}
    </button>
  )
}

export default AskButton
