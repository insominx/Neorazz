import {
  averageLuminance,
  isDarkPhoto,
} from "@razzia/web/features/visuals/photo-luminance"
import {
  BEAM_MOODS,
  type Mood,
  MOODS,
} from "@razzia/web/features/game/stores/mood"
import {
  type Flare,
  type FloorLight,
  LIGHT_RGB,
} from "@razzia/web/features/game/stores/stage-light"
import clsx from "clsx"
import { type CSSProperties, useRef, useState } from "react"

type PhotoPlacement = "viewport" | "container"

type Props =
  | { recipe: "ambient" }
  | {
      recipe: "photo"
      backgroundUrl?: string
      placement?: PhotoPlacement
      /** The colour of the light. Defaults to the cool, quiet one. */
      mood?: Mood
      /** Leaves out beams, flares and the floor light (Calm, Silent, reduced motion). */
      calm?: boolean
      /**
       * The room's light, rising from the bottom of the frame: 0 to 1 (a
       * poll's share of the room that has voted). Absent means none.
       */
      lift?: number
      /** Counts heartbeats; each new value breathes the room's light once. */
      breath?: number
      /** A moment's light rising from the floor, in its own colour. */
      floor?: FloorLight | null
      /** Moments' pools of light, with rings leaving what they sit behind. */
      flares?: Flare[]
      /** The beams turn in toward the centre. */
      focus?: boolean
    }

const Atmosphere = (props: Props) => {
  if (props.recipe === "ambient") {
    return (
      <div
        className="rounded-rz-xl pointer-events-none absolute inset-0 z-0 h-full max-h-svh w-full overflow-hidden"
        aria-hidden="true"
      >
        <div className="bg-canvas absolute inset-0" />
        <div className="bg-brand-tint rounded-rz-xl absolute top-[-70vmin] left-[-50vmin] min-h-[120vmin] min-w-[120vmin] rotate-20" />
        <div className="bg-brand-tint rounded-rz-xl absolute right-[-10vmin] bottom-[-45vmin] min-h-[75vmin] min-w-[75vmin] rotate-20" />
      </div>
    )
  }

  return (
    <PhotoAtmosphere
      key={props.backgroundUrl ?? "backdrop"}
      backgroundUrl={props.backgroundUrl}
      placement={props.placement}
      mood={props.mood}
      calm={props.calm}
      lift={props.lift}
      breath={props.breath}
      floor={props.floor}
      flares={props.flares}
      focus={props.focus}
    />
  )
}

const BEAMS = ["left", "right"] as const

/**
 * The floor light keeps its last colour while it fades out, so it never
 * changes colour on the way down.
 */
const useLastTone = (floor: FloorLight | null | undefined) => {
  const last = useRef<FloorLight["tone"]>("brand")

  if (floor) {
    last.current = floor.tone
  }

  return last.current
}

/**
 * Light made in code: a deep navy gradient, a coloured glow per mood that
 * crossfades as the game moves, and (in the full show) beams at the opening
 * and the finale. A moment adds its own light (STYLE.md, "Light, not paint"):
 * a glow rising from the floor, and pools of light with rings leaving what
 * they sit behind. There is no photo by default, so a phone downloads nothing
 * for it; a teacher's uploaded background sits above the gradient and under
 * the glow.
 */
const PhotoAtmosphere = ({
  backgroundUrl,
  placement = "viewport",
  mood = "cool",
  calm = false,
  lift,
  breath = 0,
  floor = null,
  flares = [],
  focus = false,
}: {
  backgroundUrl?: string
  placement?: PhotoPlacement
  mood?: Mood
  calm?: boolean
  lift?: number
  breath?: number
  floor?: FloorLight | null
  flares?: Flare[]
  focus?: boolean
}) => {
  const [failed, setFailed] = useState(false)
  const [darkPhoto, setDarkPhoto] = useState(false)
  const photo = backgroundUrl && !failed ? backgroundUrl : null
  const beams = !calm && BEAM_MOODS.includes(mood)
  const floorTone = useLastTone(floor)
  const floorLevel = floor && !calm ? floor.level : 0

  return (
    <div
      className={clsx(
        "pointer-events-none inset-0 z-0 overflow-hidden",
        placement === "viewport" ? "fixed" : "absolute",
      )}
      aria-hidden="true"
    >
      <div className="rz-backdrop absolute inset-0" />
      {photo && (
        // Positioned, so it paints above the backdrop; an unpositioned image
        // would sit under the absolute layer behind it and never show.
        <img
          className={clsx(
            "absolute inset-0 h-full w-full object-contain select-none",
            darkPhoto && "[filter:var(--rz-dark-photo-lift)]",
          )}
          src={photo}
          alt=""
          role="presentation"
          onLoad={(event) => {
            setDarkPhoto(isDarkPhoto(averageLuminance(event.currentTarget)))
          }}
          onError={() => {
            setFailed(true)
            setDarkPhoto(false)
          }}
        />
      )}
      {photo && !darkPhoto && (
        <div
          className="absolute inset-0 [background:var(--rz-scrim)]"
          data-atmosphere-scrim=""
        />
      )}
      {MOODS.map((candidate) => (
        <div
          key={candidate}
          className={clsx("rz-mood", `rz-mood-${candidate}`)}
          data-mood={candidate}
          data-on={candidate === mood ? "" : undefined}
        />
      ))}
      {lift !== undefined && (
        <div
          className="rz-lift"
          data-lift=""
          style={{ "--rz-lift": lift } as CSSProperties}
        />
      )}
      {lift !== undefined && breath > 0 && !calm && (
        <div
          key={breath}
          className="rz-breath"
          style={{ "--rz-lift": lift } as CSSProperties}
        />
      )}
      <div
        className="rz-floor"
        data-floor={floorLevel > 0 ? floorTone : undefined}
        style={
          {
            "--rz-light": LIGHT_RGB[floorTone],
            opacity: floorLevel,
          } as CSSProperties
        }
      />
      {!calm &&
        flares.map((flare) => (
          <div
            key={flare.id}
            className="rz-flare"
            data-flare={flare.tone}
            style={
              {
                "--rz-light": LIGHT_RGB[flare.tone],
                "--rz-flare-x": `${flare.rect.left + flare.rect.width / 2}px`,
                "--rz-flare-y": `${flare.rect.top + flare.rect.height / 2}px`,
              } as CSSProperties
            }
          >
            {Array.from({ length: flare.rings }, (_, index) => (
              <span
                key={index}
                className="rz-flare-ring"
                data-round={flare.round ? "" : undefined}
                style={{
                  top: flare.rect.top,
                  left: flare.rect.left,
                  width: flare.rect.width,
                  height: flare.rect.height,
                  animationDelay: `${index * 280}ms`,
                }}
              />
            ))}
          </div>
        ))}
      {BEAMS.map((side) => (
        <div
          key={side}
          className={clsx("rz-beam", `rz-beam-${side}`)}
          data-on={beams ? "" : undefined}
          data-focus={beams && focus ? "" : undefined}
        />
      ))}
    </div>
  )
}

export default Atmosphere
