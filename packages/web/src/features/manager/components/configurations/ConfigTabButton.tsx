import clsx from "clsx"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"

const ConfigTabButton = ({
  children,
  active,
  ...otherProps
}: ButtonHTMLAttributes<HTMLButtonElement> &
  PropsWithChildren & { active?: boolean }) => (
  <button
    className={clsx(
      // Five tabs share a phone's width, so they pad less and set smaller on
      // a small screen.
      "text-text-muted hover:bg-surface hover:text-text-body ease-calm min-w-0 flex-1 px-1.5 py-2 text-sm font-semibold transition-colors duration-[var(--rz-dur-fast)] sm:px-4 sm:text-base pointer-coarse:min-h-11",
      active && "bg-brand-tint text-brand hover:bg-brand-tint hover:text-brand",
    )}
    {...otherProps}
  >
    <div>{children}</div>
  </button>
)

export default ConfigTabButton
