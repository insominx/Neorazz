import { useEffect } from "react"
import { create } from "zustand"

/**
 * The light a moment puts in the room (STYLE.md, "Light, not paint"): a big
 * moment brightens the show's own light instead of painting the frame. A
 * screen asks for it while it is up; `Atmosphere` draws it behind everything.
 */
export type LightTone =
  | "brand"
  | "success"
  | "danger"
  | "neutral"
  | "gold"
  | "warning"

/** Each tone as an `r g b` triplet, for `rgb(var(--rz-light) / alpha)`. */
export const LIGHT_RGB: Record<LightTone, string> = {
  brand: "70 213 192",
  success: "52 217 139",
  danger: "255 106 88",
  neutral: "170 180 196",
  gold: "255 205 90",
  warning: "240 138 60",
}

/** Light rising from the bottom of the frame, as a poll's room fills. */
export interface FloorLight {
  tone: LightTone
  /** 0 to 1. */
  level: number
}

/** Where a flare sits, in viewport pixels. */
export interface LightRect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * A pool of coloured light behind something on screen, with rings of the same
 * light leaving it. A new `id` plays the rings again.
 */
export interface Flare {
  id: string
  tone: LightTone
  rect: LightRect
  rings: number
  /** Round rings from the middle of `rect`, rather than its outline. */
  round?: boolean
}

interface StageLightStore {
  floor: FloorLight | null
  flares: Flare[]
  /** The beams turn in toward the centre (the podium's roll). */
  focus: boolean
  setFloor: (_floor: FloorLight | null) => void
  setFlares: (_flares: Flare[]) => void
  setFocus: (_focus: boolean) => void
}

export const useStageLightStore = create<StageLightStore>((set) => ({
  floor: null,
  flares: [],
  focus: false,
  setFloor: (floor) => set({ floor }),
  setFlares: (flares) => set({ flares }),
  setFocus: (focus) => set({ focus }),
}))

/** Holds a floor light for as long as the calling screen asks for it. */
export const useFloorLight = (tone: LightTone | null, level = 1) => {
  useEffect(() => {
    useStageLightStore
      .getState()
      .setFloor(tone === null ? null : { tone, level })

    return () => {
      useStageLightStore.getState().setFloor(null)
    }
  }, [tone, level])
}

/** Holds flares for as long as the calling screen asks for them. */
export const useFlares = (flares: Flare[]) => {
  // The flares are read through their key, so a new array with the same
  // flares does not replay the rings.
  const key = JSON.stringify(flares)

  useEffect(() => {
    useStageLightStore.getState().setFlares(JSON.parse(key) as Flare[])

    return () => {
      useStageLightStore.getState().setFlares([])
    }
  }, [key])
}

/** Turns the beams in toward the centre while `on`. */
export const useBeamFocus = (on: boolean) => {
  useEffect(() => {
    useStageLightStore.getState().setFocus(on)

    return () => {
      useStageLightStore.getState().setFocus(false)
    }
  }, [on])
}

/** A square on the middle of `rect`, as wide as it is tall: round rings. */
export const centreOf = (rect: LightRect): LightRect => {
  const size = Math.min(rect.width, rect.height)

  return {
    top: Math.round(rect.top + (rect.height - size) / 2),
    left: Math.round(rect.left + (rect.width - size) / 2),
    width: size,
    height: size,
  }
}

/** A rectangle on screen, in the shape a flare needs. */
export const rectOf = (element: Element): LightRect => {
  const box = element.getBoundingClientRect()

  return {
    top: Math.round(box.top),
    left: Math.round(box.left),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}
