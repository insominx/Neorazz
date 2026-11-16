import { EVENTS } from "@razzia/common/constants"
import type {
  Ask,
  AskActionOutcome,
  AskRecord,
  AskRecordMeta,
  AskRoomView,
} from "@razzia/common/types/ask"
import ConfirmDialog from "@razzia/web/components/AlertDialog"
import Button from "@razzia/web/components/Button"
import { useCurtain, useInbox } from "@razzia/web/features/ask/hooks/use-inbox"
import { useInboxStore } from "@razzia/web/features/ask/stores/inbox"
import { inboxOrder } from "@razzia/web/features/ask/utils/inbox-order"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import ManagerPassword from "@razzia/web/features/manager/components/ManagerPassword"
import { emitWithAck } from "@razzia/web/features/poll/utils/emit-with-ack"
import clsx from "clsx"
import { Eye, EyeOff, Pause, Play } from "lucide-react"
import type { ReactNode } from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

type Send = (_ack: (_outcome: AskActionOutcome) => void) => void

// One inbox action: the server's answer, and a plain line if it did not go
// through. An unknown login also brings `manager:unauthorized`, which shows
// the login.
const useAction = () => {
  const { t } = useTranslation()

  return async (send: Send) => {
    const outcome = await emitWithAck<AskActionOutcome>(send)

    if (outcome !== "accepted" && outcome !== "unauthorized") {
      toast.error(t("ask:inbox.failed"), { id: "ask-inbox-action" })
    }
  }
}

const useTimeFormat = () => {
  const { i18n } = useTranslation()
  const time = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return {
    time: (iso: string) => time.format(new Date(iso)),
    date: (iso: string) => date.format(new Date(iso)),
  }
}

const SMALL_BUTTON =
  "bg-panel border-border text-text-primary rounded-rz-md border px-3 py-1.5 text-sm font-semibold"

const AskItem = ({ ask, recordId }: { ask: Ask; recordId: string }) => {
  const { socket } = useSocket()
  const { t } = useTranslation()
  const format = useTimeFormat()
  const action = useAction()

  const mark = (state: "seen" | "answered") => {
    void action((ack) => {
      socket.emit(EVENTS.ASKS.MARK, { recordId, askId: ask.id, state }, ack)
    })
  }

  return (
    <li
      data-ask-item={ask.id}
      data-ask-state={ask.state}
      className={clsx(
        "border-border rounded-rz-md flex flex-col gap-2 border p-3",
        ask.state === "new" ? "bg-surface border-brand" : "bg-panel",
      )}
    >
      <div className="text-text-muted flex items-center gap-2 text-xs font-semibold">
        <span className="font-mono">{format.time(ask.at)}</span>
        <span aria-hidden>·</span>
        {ask.name ? (
          <span data-ask-item-name className="text-text-primary">
            {ask.name}
          </span>
        ) : (
          <span>{t("ask:inbox.anonymous")}</span>
        )}
        <span
          className={clsx(
            "ml-auto rounded-full px-2 py-0.5 uppercase",
            ask.state === "new" && "bg-brand text-on-accent",
            ask.state === "answered" && "text-success",
          )}
        >
          {t(`ask:inbox.state.${ask.state}`)}
        </span>
      </div>

      {/* Text only: React writes it as a text node, never as markup. */}
      <p
        data-ask-item-text
        className="text-text-primary text-base break-words whitespace-pre-wrap"
      >
        {ask.text}
      </p>

      <div className="flex flex-wrap gap-2">
        {ask.state === "new" && (
          <button
            type="button"
            data-ask-got-it
            className={SMALL_BUTTON}
            onClick={() => {
              mark("seen")
            }}
          >
            {t("ask:inbox.gotIt")}
          </button>
        )}
        {ask.state !== "answered" && (
          <button
            type="button"
            data-ask-answered
            className={SMALL_BUTTON}
            onClick={() => {
              mark("answered")
            }}
          >
            {t("ask:inbox.answered")}
          </button>
        )}
        <ConfirmDialog
          trigger={
            <button
              type="button"
              data-ask-delete
              className={clsx(SMALL_BUTTON, "text-danger ml-auto")}
            >
              {t("ask:inbox.delete")}
            </button>
          }
          title={t("ask:inbox.deleteAskTitle")}
          description={t("ask:inbox.deleteAskBody")}
          confirmLabel={t("ask:inbox.delete")}
          onConfirm={() => {
            void action((ack) => {
              socket.emit(EVENTS.ASKS.REMOVE, { recordId, askId: ask.id }, ack)
            })
          }}
        />
      </div>
    </li>
  )
}

const AskList = ({ record }: { record: AskRecord }) => {
  const { t } = useTranslation()

  if (record.asks.length === 0) {
    return <p className="text-text-muted text-sm">{t("ask:inbox.empty")}</p>
  }

  // Newest first: what just arrived is what the presenter looks for.
  return (
    <ul className="flex flex-col gap-2">
      {[...record.asks].reverse().map((ask) => (
        <AskItem key={ask.id} ask={ask} recordId={record.id} />
      ))}
    </ul>
  )
}

const GotAll = ({ recordId }: { recordId: string }) => {
  const { socket } = useSocket()
  const { t } = useTranslation()
  const action = useAction()

  return (
    <button
      type="button"
      data-ask-got-all
      className={SMALL_BUTTON}
      onClick={() => {
        void action((ack) => {
          socket.emit(EVENTS.ASKS.MARK_ALL, { recordId }, ack)
        })
      }}
    >
      {t("ask:inbox.gotAll")}
    </button>
  )
}

const Waiting = ({ count }: { count: number }) => {
  const { t } = useTranslation()

  return (
    <span
      className={clsx(
        "rounded-full px-2.5 py-0.5 font-mono text-sm font-bold",
        count > 0 ? "bg-brand text-on-accent" : "bg-panel text-text-muted",
      )}
    >
      {t("ask:inbox.waiting", { count })}
    </span>
  )
}

const Block = ({
  children,
  ...data
}: { children: ReactNode } & Record<`data-${string}`, string | undefined>) => (
  <section
    {...data}
    className="bg-surface border-border rounded-rz-lg flex flex-col gap-3 border p-4"
  >
    {children}
  </section>
)

const RoomBlock = ({ room }: { room: AskRoomView }) => {
  const { socket } = useSocket()
  const { t } = useTranslation()
  const revealed = useInboxStore((state) => state.revealed)
  const action = useAction()

  // One tap, curtained or not: a pause shows no question.
  const toggle = () => {
    void action((ack) => {
      socket.emit(
        EVENTS.ASKS.SET_OPEN,
        { gameId: room.gameId, open: !room.open },
        ack,
      )
    })
  }

  return (
    <Block
      data-ask-room={room.gameId}
      data-ask-box={room.open ? "open" : "closed"}
      data-ask-record={room.record?.id}
    >
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-brand text-xs font-bold tracking-[0.12em] uppercase">
            {t("ask:inbox.liveRoom")}
          </p>
          <h2 className="text-text-primary truncate text-lg font-bold">
            {room.gameSubject}
          </h2>
          <p className="text-text-muted font-mono text-xs">
            {t("ask:inbox.pin", { pin: room.inviteCode })}
            {!room.open && ` · ${t("ask:inbox.paused")}`}
            {!room.saved && ` · ${t("ask:inbox.notSaved")}`}
          </p>
        </div>
        <Waiting count={room.waiting} />
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-ask-pause
          aria-pressed={!room.open}
          onClick={toggle}
          className={clsx(
            "rounded-rz-md flex items-center gap-2 border px-4 py-2 text-base font-bold",
            room.open
              ? "bg-panel border-border text-text-primary"
              : "bg-warning text-on-accent border-warning",
          )}
        >
          {room.open ? (
            <Pause aria-hidden className="size-4" />
          ) : (
            <Play aria-hidden className="size-4" />
          )}
          {room.open ? t("ask:inbox.pause") : t("ask:inbox.resume")}
        </button>
        {revealed && room.record && room.waiting > 0 && (
          <GotAll recordId={room.record.id} />
        )}
      </div>

      {revealed &&
        (room.record ? (
          <AskList record={room.record} />
        ) : (
          <p className="text-text-muted text-sm">{t("ask:inbox.empty")}</p>
        ))}
    </Block>
  )
}

const RecordBlock = ({
  meta,
  refetch,
}: {
  meta: AskRecordMeta
  refetch: (_id: string) => Promise<void>
}) => {
  const { socket } = useSocket()
  const { t } = useTranslation()
  const format = useTimeFormat()
  const revealed = useInboxStore((state) => state.revealed)
  const record = useInboxStore((state) => state.opened[meta.id])
  const action = useAction()

  return (
    <Block data-ask-record={meta.id}>
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="text-text-muted text-xs font-bold tracking-[0.12em] uppercase">
            {format.date(meta.date)}
          </p>
          <h2 className="text-text-primary truncate text-lg font-bold">
            {meta.gameSubject}
          </h2>
          <p className="text-text-muted text-xs">
            {t("ask:inbox.total", { count: meta.total })}
          </p>
        </div>
        <Waiting count={meta.waiting} />
      </header>

      {revealed && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-ask-record-open
            className={SMALL_BUTTON}
            onClick={() => {
              if (record) {
                useInboxStore.getState().setOpened(meta.id, null)
              } else {
                void refetch(meta.id)
              }
            }}
          >
            {record ? t("ask:inbox.hide") : t("ask:inbox.open")}
          </button>
          {record && meta.waiting > 0 && <GotAll recordId={meta.id} />}
          <ConfirmDialog
            trigger={
              <button
                type="button"
                data-ask-record-delete
                className={clsx(SMALL_BUTTON, "text-danger ml-auto")}
              >
                {t("ask:inbox.deleteRecord")}
              </button>
            }
            title={t("ask:inbox.deleteRecordTitle")}
            description={t("ask:inbox.deleteRecordBody")}
            confirmLabel={t("ask:inbox.deleteRecord")}
            onConfirm={() => {
              void action((ack) => {
                socket.emit(
                  EVENTS.ASKS.RECORD_DELETE,
                  { recordId: meta.id },
                  ack,
                )
              })
            }}
          />
        </div>
      )}

      {revealed && record && <AskList record={record} />}
    </Block>
  )
}

/**
 * The presenter's inbox, laid out for a phone. It shows each live room and
 * each earlier record by its counts until **Show questions**, and goes back to
 * counts whenever the page is hidden or loses focus (`useCurtain`). Nothing
 * is marked seen by being shown.
 */
const Inbox = () => {
  const { socket, isConnected } = useSocket()
  const { t } = useTranslation()
  const live = useInboxStore((state) => state.live)
  const needsLogin = useInboxStore((state) => state.needsLogin)
  const revealed = useInboxStore((state) => state.revealed)
  const { refetch } = useInbox()

  useCurtain()

  const waiting =
    (live?.rooms.reduce((sum, room) => sum + room.waiting, 0) ?? 0) +
    (live?.records.reduce((sum, record) => sum + record.waiting, 0) ?? 0)

  return (
    <main className="bg-canvas text-text-body min-h-dvh">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-10">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-text-primary text-2xl font-bold">
            {t("ask:inbox.title")}
          </h1>
          <p
            role="status"
            data-inbox-status={isConnected ? "live" : "reconnecting"}
            className={clsx(
              "rounded-full px-3 py-1 text-sm font-bold",
              isConnected
                ? "bg-panel text-success"
                : "bg-warning text-on-accent",
            )}
          >
            {isConnected ? t("ask:inbox.live") : t("common:reconnecting")}
          </p>
        </header>

        {needsLogin && (
          <ManagerPassword
            onSubmit={(password) => {
              socket.emit(EVENTS.MANAGER.AUTH, password)
            }}
          />
        )}

        {!needsLogin && !live && (
          <p className="text-text-muted">{t("common:loading")}</p>
        )}

        {!needsLogin && live && (
          <>
            {!revealed && (
              <div className="bg-panel border-border rounded-rz-lg flex flex-col gap-3 border p-4">
                <p className="text-text-primary text-lg font-bold">
                  {t("ask:inbox.waiting", { count: waiting })}
                </p>
                <p className="text-text-muted text-sm">
                  {t("ask:inbox.curtainNote")}
                </p>
                <Button
                  type="button"
                  size="lg"
                  data-inbox-reveal
                  onClick={() => {
                    useInboxStore.getState().reveal()
                  }}
                >
                  <Eye aria-hidden className="size-5" />
                  {t("ask:inbox.reveal")}
                </Button>
              </div>
            )}

            {/* Covering the text by hand, without leaving the page. */}
            {revealed && (
              <button
                type="button"
                data-inbox-hide
                onClick={() => {
                  useInboxStore.getState().curtain()
                }}
                className="bg-panel border-border text-text-primary rounded-rz-md flex items-center justify-center gap-2 border px-4 py-3 text-base font-bold"
              >
                <EyeOff aria-hidden className="size-5" />
                {t("ask:inbox.hideQuestions")}
              </button>
            )}

            {live.rooms.length === 0 && live.records.length === 0 && (
              <p className="text-text-muted">{t("ask:inbox.nothing")}</p>
            )}

            {inboxOrder(live).map((entry) =>
              entry.kind === "room" ? (
                <RoomBlock key={entry.room.gameId} room={entry.room} />
              ) : (
                <RecordBlock
                  key={entry.meta.id}
                  meta={entry.meta}
                  refetch={refetch}
                />
              ),
            )}
          </>
        )}
      </div>
    </main>
  )
}

export default Inbox
