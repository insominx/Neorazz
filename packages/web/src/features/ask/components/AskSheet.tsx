import * as Switch from "@radix-ui/react-switch"
import { ASK_LIMITS, cleanAskText } from "@razzia/common/validators/ask"
import Button from "@razzia/web/components/Button"
import { useVisibleViewport } from "@razzia/web/features/ask/hooks/use-visible-viewport"
import { sendDraft } from "@razzia/web/features/ask/send"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import clsx from "clsx"
import { Send, X } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

const TITLE_ID = "ask-sheet-title"
const SIGN_ID = "ask-sheet-sign"

const close = () => {
  useAskStore.getState().closeSheet(true)
}

/**
 * The fold-out a phone types its question in. It is drawn above everything,
 * a poll included, and outside what a poll makes inert, so it closes itself
 * whenever the button stops being offered (`useAskLane`); the draft stays.
 * It is rendered only while open.
 *
 * It sits at the bottom of the part of the screen the person can see, so an
 * on-screen keyboard pushes it up rather than covering Send.
 */
const AskSheetBody = () => {
  const { socket, isConnected } = useSocket()
  const gameId = usePlayerStore((state) => state.gameId)
  const draft = useAskStore((state) => state.draft)
  const sending = useAskStore((state) => state.sending)
  const result = useAskStore((state) => state.result)
  const viewport = useVisibleViewport()
  const text = useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    text.current?.focus()
  }, [])

  const sendable =
    isConnected &&
    !sending &&
    gameId !== null &&
    cleanAskText(draft.text) !== null

  const send = () => {
    if (sendable) {
      void sendDraft(socket, gameId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      close()
    }
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-50"
      style={
        viewport
          ? {
              height: viewport.height,
              transform: `translateY(${viewport.top}px)`,
            }
          : { height: "100dvh" }
      }
      onKeyDown={handleKeyDown}
    >
      <div
        aria-hidden
        className="bg-overlay animate-rz-fade-in absolute inset-0"
        onClick={close}
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        data-ask-sheet
        className="bg-surface border-border rounded-t-rz-xl animate-rz-fade-in absolute inset-x-0 bottom-0 mx-auto flex max-h-full w-full max-w-xl flex-col border-t"
      >
        <header className="flex items-center justify-between gap-3 px-4 pt-3">
          <h2 id={TITLE_ID} className="text-text-primary text-lg font-bold">
            {t("ask:title")}
          </h2>
          <button
            type="button"
            aria-label={t("ask:close")}
            onClick={close}
            className="text-text-muted hover:text-text-primary focus-visible:outline-brand -mr-2.5 grid size-11 place-items-center rounded-full focus-visible:outline-2"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-2 pb-3">
          <textarea
            ref={text}
            data-ask-text
            value={draft.text}
            maxLength={ASK_LIMITS.TEXT}
            rows={3}
            readOnly={sending}
            aria-labelledby={TITLE_ID}
            placeholder={t("ask:placeholder")}
            onChange={(event) => {
              useAskStore.getState().editDraft({ text: event.target.value })
            }}
            className="bg-panel border-border text-text-primary placeholder:text-text-faint focus-visible:outline-brand rounded-rz-md min-h-24 w-full shrink-0 resize-none border p-3 text-base focus-visible:outline-2"
          />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch.Root
                id={SIGN_ID}
                data-ask-sign
                checked={draft.signed}
                disabled={sending}
                onCheckedChange={(signed) => {
                  useAskStore.getState().editDraft({ signed })
                }}
                className="bg-panel border-border focus-visible:outline-brand data-[state=checked]:bg-brand ease-calm relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus-visible:outline-2"
              >
                <Switch.Thumb className="bg-text-primary ease-calm block size-4 translate-x-1 rounded-full transition-transform data-[state=checked]:translate-x-5.5" />
              </Switch.Root>
              {/* The label toggles the switch, so it carries the finger-sized
                  target the slim switch does not. */}
              <label
                htmlFor={SIGN_ID}
                className="text-text-primary py-3 text-sm font-semibold"
              >
                {t("ask:sign")}
              </label>
            </div>
            <span
              aria-hidden
              className="text-text-faint shrink-0 font-mono text-xs"
            >
              {draft.text.length}/{ASK_LIMITS.TEXT}
            </span>
          </div>

          <ul className="text-text-muted flex flex-col gap-1 text-sm leading-snug">
            <li>{t("ask:privacy.private")}</li>
            <li>{t("ask:privacy.count")}</li>
            <li>{t("ask:privacy.kept")}</li>
          </ul>
        </div>

        <footer className="border-border flex flex-col gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p
            role="status"
            data-ask-outcome={result ?? undefined}
            className={clsx(
              "min-h-5 text-sm font-semibold",
              result === "accepted" ? "text-success" : "text-warning",
            )}
          >
            {result
              ? t(`ask:outcome.${result}`)
              : !isConnected && t("common:reconnecting")}
          </p>
          <Button
            type="button"
            data-ask-send
            size="lg"
            disabled={!sendable}
            onClick={send}
          >
            <Send aria-hidden className="size-5" />
            {sending ? t("ask:sending") : t("ask:send")}
          </Button>
        </footer>
      </section>
    </div>
  )
}

const AskSheet = () => {
  const open = useAskStore((state) => state.sheetOpen)

  return open ? <AskSheetBody /> : null
}

export default AskSheet
