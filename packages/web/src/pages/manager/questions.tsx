import Inbox from "@razzia/web/features/ask/components/Inbox"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

// Inside any frame this page may be on a projected screen (a deck's frame
// shows manager pages to the room), so there it draws a notice and nothing
// else, and does not watch.
export const isFramed = (win: { self: unknown; top: unknown }): boolean => {
  try {
    return win.self !== win.top
  } catch {
    // A parent of another origin that will not say: framed.
    return true
  }
}

// Read once: a page does not move between frames.
const FRAMED = isFramed(window)

const FramedNotice = () => {
  const { t } = useTranslation()

  return (
    <main className="bg-canvas text-text-muted grid min-h-dvh place-items-center p-6 text-center">
      <p data-inbox-framed>{t("ask:inbox.framed")}</p>
    </main>
  )
}

export const QuestionsView = ({ framed }: { framed: boolean }) =>
  framed ? <FramedNotice /> : <Inbox />

/**
 * The presenter's question inbox. Linked from no other page: it is opened
 * from a bookmark on the presenter's own phone.
 */
const QuestionsPage = () => <QuestionsView framed={FRAMED} />

export const Route = createFileRoute("/manager/questions")({
  component: QuestionsPage,
})
