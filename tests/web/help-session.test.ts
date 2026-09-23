import { afterEach, expect, it, vi } from "vitest";
import {
  HELP_AUTO_CLOSE_MS,
  createHelpAutoClose,
} from "../../web/help-session.js";

afterEach(() => {
  vi.useRealTimers();
});

it("closes once after 15 seconds and a switch restarts that wait", () => {
  vi.useFakeTimers();
  const closed: string[] = [];
  const session = createHelpAutoClose({
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
  });
  expect(HELP_AUTO_CLOSE_MS).toBe(15_000);
  session.restart(() => closed.push("first"));
  vi.advanceTimersByTime(14_000);
  expect(closed).toEqual([]);
  session.restart(() => closed.push("second"));
  vi.advanceTimersByTime(14_000);
  expect(closed).toEqual([]);
  vi.advanceTimersByTime(1_000);
  expect(closed).toEqual(["second"]);
  vi.advanceTimersByTime(20_000);
  expect(closed).toEqual(["second"]);
});

it("an older callback cannot close a newer explanation, and cancel blocks the current one", () => {
  const closed: string[] = [];
  const pending: Array<() => void> = [];
  const session = createHelpAutoClose({
    setTimeout: (callback) => {
      pending.push(callback);
      return pending.length;
    },
    clearTimeout: () => {},
  });
  session.restart(() => closed.push("old"));
  const stale = pending[0]!;
  session.restart(() => closed.push("new"));
  stale();
  expect(closed).toEqual([]);
  pending[1]!();
  expect(closed).toEqual(["new"]);
  session.restart(() => closed.push("third"));
  session.cancel();
  pending[2]!();
  expect(closed).toEqual(["new"]);
});
