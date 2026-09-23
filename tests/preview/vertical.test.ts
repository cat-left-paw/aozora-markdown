import { describe, expect, it } from "vitest";
import {
  applyAdvance,
  keyAdvance,
  toVerticalStart,
  wheelAdvance,
  type WheelLike,
} from "../../web/preview/vertical.js";
import { HELP_TOPICS } from "../../web/catalog.js";
import {
  MODE_HINT_TEXT,
  NOTICE_TEXT,
  VERTICAL_GUIDE_TEXT,
  noticeTexts,
} from "../../web/preview/messages.js";

/** A scroller that clamps like a browser, in either coordinate system. */
function scroller(system: "negative" | "positive", range = 1000, width = 300) {
  const min = system === "negative" ? -range : 0,
    max = system === "negative" ? 0 : range;
  let value = max;
  return {
    clientWidth: width,
    get scrollLeft() {
      return value;
    },
    set scrollLeft(v: number) {
      value = Math.min(max, Math.max(min, v));
    },
    min,
    max,
  };
}
const wheel = (over: Partial<WheelLike> = {}): WheelLike => ({
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  cancelable: true,
  ...over,
});
const key = (k: string, over: Partial<KeyboardEventInit> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("VP-02 wheel mapping", () => {
  it("down advances (leftward), up goes back; pixels are not accelerated", () => {
    const box = scroller("negative");
    expect(wheelAdvance(wheel(), box, 30)).toBe(100);
    expect(wheelAdvance(wheel({ deltaY: -40 }), box, 30)).toBe(-40);
  });
  it("line and page modes scale by line height and visible width", () => {
    const box = scroller("negative", 1000, 300);
    expect(wheelAdvance(wheel({ deltaY: 3, deltaMode: 1 }), box, 30)).toBe(90);
    expect(wheelAdvance(wheel({ deltaY: 1, deltaMode: 2 }), box, 30)).toBe(270);
    expect(wheelAdvance(wheel({ deltaY: -1, deltaMode: 2 }), box, 30)).toBe(
      -270,
    );
  });
  it("small trackpad deltas still move one pixel in their direction", () => {
    const box = scroller("negative");
    expect(wheelAdvance(wheel({ deltaY: 0.4 }), box, 30)).toBe(1);
    expect(wheelAdvance(wheel({ deltaY: -0.2 }), box, 30)).toBe(-1);
  });
  it("zoom, Shift, Alt, horizontal gestures and non-cancelable events are left to the browser", () => {
    const box = scroller("negative");
    for (const over of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { cancelable: false },
      { deltaX: 120, deltaY: 30 },
      { deltaX: -50, deltaY: 50 },
      { deltaY: 0 },
    ])
      expect(wheelAdvance(wheel(over), box, 30), JSON.stringify(over)).toBe(
        undefined,
      );
  });
  it("moves report true only when scrollLeft changed, in both coordinate systems", () => {
    for (const system of ["negative", "positive"] as const) {
      const box = scroller(system);
      toVerticalStart(box);
      expect(box.scrollLeft, system).toBe(box.max);
      expect(applyAdvance(box, 300)).toBe(true);
      expect(box.scrollLeft).toBe(box.max - 300);
      expect(applyAdvance(box, -150)).toBe(true);
      expect(box.scrollLeft).toBe(box.max - 150);
      expect(applyAdvance(box, -1000)).toBe(true);
      expect(box.scrollLeft).toBe(box.max);
      // At the reading start, "back" must not be swallowed: the page scrolls.
      expect(applyAdvance(box, -100)).toBe(false);
      expect(applyAdvance(box, "end")).toBe(true);
      expect(box.scrollLeft).toBe(box.min);
      expect(applyAdvance(box, 100)).toBe(false);
      expect(applyAdvance(box, "start")).toBe(true);
      expect(box.scrollLeft).toBe(box.max);
    }
  });
});

describe("VP-02 keyboard mapping", () => {
  it("arrows move one line, pages keep one line of overlap, Home/End jump", () => {
    const box = scroller("negative", 1000, 300);
    expect(keyAdvance(key("ArrowLeft"), box, 30)).toBe(30);
    expect(keyAdvance(key("ArrowRight"), box, 30)).toBe(-30);
    expect(keyAdvance(key("PageDown"), box, 30)).toBe(270);
    expect(keyAdvance(key("PageUp"), box, 30)).toBe(-270);
    expect(keyAdvance(key(" "), box, 30)).toBe(270);
    expect(keyAdvance(key(" ", { shiftKey: true }), box, 30)).toBe(-270);
    expect(keyAdvance(key("Home"), box, 30)).toBe("start");
    expect(keyAdvance(key("End"), box, 30)).toBe("end");
  });
  it("modifier chords, selection keys and other keys are not handled", () => {
    const box = scroller("negative");
    for (const [k, over] of [
      ["ArrowLeft", { shiftKey: true }],
      ["ArrowLeft", { ctrlKey: true }],
      ["ArrowRight", { metaKey: true }],
      ["PageDown", { altKey: true }],
      ["ArrowDown", {}],
      ["ArrowUp", {}],
      ["Tab", {}],
      ["Enter", {}],
      ["a", {}],
    ] as const)
      expect(keyAdvance(key(k, over), box, 30), k).toBe(undefined);
  });
  it("a narrow viewport still pages by at least one line", () => {
    expect(
      keyAdvance(key("PageDown"), scroller("negative", 1000, 20), 30),
    ).toBe(30);
  });
});

describe("VP-01 mode wording", () => {
  it("tcy-horizontal is a horizontal-only notice; other notices are unchanged", () => {
    const codes = ["tcy-horizontal", "link-not-opened"] as const;
    expect(noticeTexts(codes, "horizontal")).toEqual([
      NOTICE_TEXT["tcy-horizontal"],
      NOTICE_TEXT["link-not-opened"],
    ]);
    const vertical = noticeTexts(codes, "vertical");
    expect(vertical[0]).not.toBe(NOTICE_TEXT["tcy-horizontal"]);
    expect(vertical[0]).not.toContain("横書きでは");
    expect(vertical[0]).toContain("参考表示");
    expect(vertical[1]).toBe(NOTICE_TEXT["link-not-opened"]);
    expect(noticeTexts([], "vertical")).toEqual([]);
  });
  it("both explanations are reference-only; the guide states start and direction", () => {
    expect(MODE_HINT_TEXT.horizontal).toContain("横書きの参考表示");
    expect(MODE_HINT_TEXT.vertical).toContain("縦書きの参考表示");
    expect(MODE_HINT_TEXT.vertical).toContain("ページ割り");
    expect(VERTICAL_GUIDE_TEXT).toContain("右端の行から読み始め");
    expect(VERTICAL_GUIDE_TEXT).toContain("右から左");
    expect(VERTICAL_GUIDE_TEXT).toContain(
      "ホイールはページのスクロールに戻ります",
    );
    expect(VERTICAL_GUIDE_TEXT).toContain("frontmatter");
    const topic = HELP_TOPICS.find(
      (item) => item.id === "preview-vertical-ops",
    );
    expect(topic?.control).toBe("button");
    expect(topic?.optionKey).toBeUndefined();
    expect(topic?.detail).toBe(VERTICAL_GUIDE_TEXT);
  });
});
