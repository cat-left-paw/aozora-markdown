/**
 * Scroll mapping for the vertical-rl preview. Browsers differ in the sign and
 * origin of `scrollLeft` for right-to-left block flow, so nothing here assumes
 * a coordinate system: "advance" always means a smaller `scrollLeft` (further
 * left), the start is reached by assigning a huge value and the end a huge
 * negative one, and the browser's clamping decides where that lands.
 */
export interface HorizontalScroller {
  scrollLeft: number;
  readonly clientWidth: number;
}

export interface WheelLike {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly cancelable: boolean;
}

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const FAR = 1e9;

/** One page keeps one line visible so the reader does not lose their place. */
function pageStep(box: HorizontalScroller, line: number) {
  return Math.max(line, box.clientWidth - line);
}

/**
 * Pixels to advance (positive = next line, leftward) for a wheel event, or
 * undefined when the browser should handle it: zoom and Shift gestures,
 * horizontal-dominant trackpad movement and non-cancelable events.
 */
export function wheelAdvance(
  event: WheelLike,
  box: HorizontalScroller,
  line: number,
): number | undefined {
  if (!event.cancelable) return undefined;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return undefined;
  if (!event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
    return undefined;
  const px =
    event.deltaMode === DOM_DELTA_LINE
      ? event.deltaY * line
      : event.deltaMode === DOM_DELTA_PAGE
        ? event.deltaY * pageStep(box, line)
        : event.deltaY;
  // Sub-pixel trackpad deltas would otherwise round to no movement.
  return Math.abs(px) < 1 ? Math.sign(px) : px;
}

export type KeyMove = number | "start" | "end";

export function keyAdvance(
  event: KeyLike,
  box: HorizontalScroller,
  line: number,
): KeyMove | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.key === " ")
    return event.shiftKey ? -pageStep(box, line) : pageStep(box, line);
  if (event.shiftKey) return undefined;
  switch (event.key) {
    case "ArrowLeft":
      return line;
    case "ArrowRight":
      return -line;
    case "PageDown":
      return pageStep(box, line);
    case "PageUp":
      return -pageStep(box, line);
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return undefined;
  }
}

/** Applies a move; true only when the scroller actually moved. */
export function applyAdvance(box: HorizontalScroller, move: KeyMove): boolean {
  const before = box.scrollLeft;
  box.scrollLeft =
    move === "start" ? FAR : move === "end" ? -FAR : before - move;
  return box.scrollLeft !== before;
}

/** Reading start of a vertical-rl scroller: its right edge. */
export function toVerticalStart(box: HorizontalScroller) {
  box.scrollLeft = FAR;
}
