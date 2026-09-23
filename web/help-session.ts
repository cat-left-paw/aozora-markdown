/** How long a supplemental explanation stays open after its button is pressed. */
export const HELP_AUTO_CLOSE_MS = 15_000;

export interface HelpClock {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/**
 * One auto-close timer for the open explanation.
 * restart invalidates any timer already scheduled, so an older callback cannot close a newer explanation.
 */
export function createHelpAutoClose(clock: HelpClock) {
  let generation = 0;
  let timer = 0;
  return {
    restart(close: () => void) {
      if (timer) clock.clearTimeout(timer);
      const ticket = ++generation;
      timer = clock.setTimeout(() => {
        if (ticket !== generation) return;
        timer = 0;
        close();
      }, HELP_AUTO_CLOSE_MS);
    },
    cancel() {
      generation += 1;
      if (!timer) return;
      clock.clearTimeout(timer);
      timer = 0;
    },
  };
}
