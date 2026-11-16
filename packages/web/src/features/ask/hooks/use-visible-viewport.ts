import { useEffect, useState } from "react"

export interface VisibleViewport {
  height: number
  top: number
}

const read = (): VisibleViewport | null => {
  const viewport = typeof window === "undefined" ? null : window.visualViewport

  return viewport ? { height: viewport.height, top: viewport.offsetTop } : null
}

/**
 * The part of the page the person can see, which an on-screen keyboard
 * shrinks. Phones differ in whether the keyboard resizes the page (`dvh`
 * follows it on some and not on others), so a sheet that must stay above the
 * keyboard sizes itself to this instead. `null` where the browser cannot say.
 */
export const useVisibleViewport = (): VisibleViewport | null => {
  const [visible, setVisible] = useState(read)

  useEffect(() => {
    const viewport = window.visualViewport

    if (!viewport) {
      return
    }

    const update = () => {
      setVisible(read())
    }

    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)

    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  return visible
}
