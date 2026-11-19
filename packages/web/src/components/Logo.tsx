import logo from "@razzia/web/assets/logo.svg"
import clsx from "clsx"

interface Props {
  className?: string
}

/**
 * The Neorazz wordmark: seven split-flap cards in front of the brand ring.
 * The cards carry their own dark fill and edge, so the same svg reads on the
 * dark register and the light one.
 */
const Logo = ({ className }: Props) => (
  <img
    src={logo}
    alt="Neorazz"
    draggable={false}
    className={clsx("block aspect-[360/124] select-none", className)}
  />
)

export default Logo
