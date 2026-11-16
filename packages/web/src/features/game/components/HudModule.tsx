import clsx from "clsx"

type HudRole = "info" | "sequence"

interface Props {
  label: string
  value: string
  role: HudRole
  className?: string
  /** Time is short: the digit grows and heats up, and pulses on every tick. */
  urgent?: boolean
  /**
   * Counts arrivals: each new value flashes the digit once, the way a poll's
   * count steps up (0 never flashes).
   */
  flash?: number
}

const ROLE_LABEL: Record<HudRole, string> = {
  info: "text-info",
  sequence: "text-sequence",
}

/**
 * One large number with a small label: the clock, or how many have answered.
 * The digit is the thing read from the back of the room, so it is big and
 * plain; the label is the only small type here.
 */
const HudModule = ({
  label,
  value,
  role,
  className,
  urgent = false,
  flash = 0,
}: Props) => (
  <div className={clsx("flex flex-col items-start", className)}>
    <span
      className={clsx(
        "stage:text-[1.125rem] text-xs font-bold tracking-[0.18em] uppercase",
        ROLE_LABEL[role],
      )}
    >
      {label}
    </span>
    <span
      // A new key restarts the pulse each second of the last five, and the
      // flash on each arrival.
      key={urgent ? value : `calm-${flash}`}
      data-hud-value
      className={clsx(
        "font-display leading-none font-bold tabular-nums",
        "stage:text-[5rem] short:text-[1.75rem] text-[2.25rem]",
        urgent ? "text-warning rz-hud-hot" : "text-text-primary",
        !urgent && flash > 0 && "rz-hud-flash",
      )}
    >
      {value}
    </span>
  </div>
)

export default HudModule
