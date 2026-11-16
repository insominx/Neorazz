import { useCalmVisuals } from "@razzia/web/features/game/hooks/use-show-intensity"
import clsx from "clsx"
import { forwardRef, type ReactNode } from "react"

export type MomentTone = "brand" | "warning" | "gold"

interface Props {
  tone: MomentTone
  /** It is on its way out: it rises and fades. */
  leaving?: boolean
  className?: string
  children: ReactNode
}

/**
 * A moment's word or name (GO, TIME, the winner), landing the way a poll's
 * names do: it rises a little and sharpens in, in its tone's colour with a
 * glow, holds, and leaves upward. Calm and reduced motion fade it instead. Its
 * light (a glow from the floor, rings) is the atmosphere's, asked for by the
 * screen, so nothing here fills or covers the frame (STYLE.md, "Light, not
 * paint").
 */
const StageMoment = forwardRef<HTMLParagraphElement, Props>(
  ({ tone, leaving = false, className, children }, ref) => {
    const calm = useCalmVisuals()

    return (
      <p
        ref={ref}
        data-moment={tone}
        data-tone={tone}
        data-leaving={leaving ? "" : undefined}
        data-calm={calm ? "" : undefined}
        className={clsx("rz-moment leading-none font-extrabold", className)}
      >
        {children}
      </p>
    )
  },
)

StageMoment.displayName = "StageMoment"

export default StageMoment
