import { Controller, type Change } from "./controller.js";
import {
  DETAILS_BRIEF,
  DETAILS_CLOSE_LABEL,
  DETAILS_OPEN_LABEL,
  GROUP_CONTAINERS,
  HELP_TOPICS,
  NO_CONTENT_CONVERSION,
  PICKER_FORMATS,
  PICKER_REPLACE,
  REMAINING_NOTES_LABEL,
  helpTopic,
  type HelpTopic,
} from "./catalog.js";
import { createHelpAutoClose } from "./help-session.js";
import {
  BOOLEAN_CONTROLS,
  DEFAULT_IMPORT_LIMITS,
  isNoContentConversion,
  selectionIssues,
  type ConversionSettings,
} from "./options.js";
import type { HeadingLevel, HeadingLevels } from "../src/index.js";
import {
  PAGE_SIZE,
  deliveryButtonLabel,
  fileSelectionPresentation,
  pageOf,
} from "./state.js";
import { explain, severityLabel } from "./diagnostics.js";
import { renderPreview, type PreviewDom } from "./preview/render.js";
import { sourceWindow } from "./preview/source.js";
import {
  MODE_HINT_TEXT,
  noticeTexts,
  previewStatusText,
  sourceStatusText,
} from "./preview/messages.js";
import type {
  PreviewFace,
  PreviewMode,
  PreviewTab,
} from "./preview/session.js";
import {
  applyAdvance,
  keyAdvance,
  toVerticalStart,
  wheelAdvance,
} from "./preview/vertical.js";
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const bytes = (n: number) => `${n.toLocaleString()} bytes`;
const attentionCount = (n: number, unit: string, kind: "error" | "note") => {
  const span = el("span", `${n}${unit}`);
  if (n > 0) span.className = `attention-count attention-count--${kind}`;
  return span;
};
export function mount(
  controller: Controller,
  root: Document = document,
): () => void {
  const byId = <T extends HTMLElement>(id: string) =>
    root.getElementById(id) as T;
  const listeners = new AbortController(),
    controls = new Map<keyof ConversionSettings, HTMLInputElement>();
  const on = (
    node: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) =>
    node.addEventListener(type, listener, {
      ...options,
      signal: listeners.signal,
    });
  const button = (id: string, action: () => void) =>
    on(byId(id), "click", () => action());
  const conversion = (key: keyof ConversionSettings, value: boolean | string) =>
    controller.changeSettings({
      ...controller.state.settings,
      conversion: { ...controller.state.settings.conversion, [key]: value },
    });
  const headingLevel = (key: keyof HeadingLevels, value: HeadingLevel) =>
    controller.changeSettings({
      ...controller.state.settings,
      conversion: {
        ...controller.state.settings.conversion,
        headingLevels: {
          ...controller.state.settings.conversion.headingLevels,
          [key]: value,
        },
      },
    });
  const groupOf = (topic: HelpTopic) => {
    if (topic.parent) return byId("children-" + topic.parent);
    const container =
      GROUP_CONTAINERS[topic.group as keyof typeof GROUP_CONTAINERS];
    return byId(container);
  };
  for (const topic of HELP_TOPICS) {
    if (topic.control !== "boolean" || !topic.optionKey) continue;
    const block = el("div"),
      wrap = el("div"),
      row = el("div"),
      label = el("label"),
      input = el("input"),
      help = el("button", "説明"),
      summary = el("p", topic.summary),
      children = el("div");
    block.className = "setting-block";
    wrap.className = "setting";
    wrap.dataset.helpHost = topic.id;
    row.className = "setting-row";
    label.className = "check";
    input.type = "checkbox";
    input.id = "option-" + topic.optionKey;
    input.dataset.describedSummary = "summary-" + topic.id;
    input.dataset.settingId = topic.id;
    label.append(input, el("span", topic.label));
    help.type = "button";
    help.className = "help";
    help.dataset.helpFor = topic.id;
    summary.className = "setting-summary";
    summary.id = "summary-" + topic.id;
    children.className = "setting-children";
    children.id = "children-" + topic.optionKey;
    row.append(label, help);
    wrap.append(row, summary);
    block.append(wrap, children);
    groupOf(topic).append(block);
    controls.set(topic.optionKey, input);
    on(input, "change", () => conversion(topic.optionKey!, input.checked));
  }
  // Static child controls move under their parent toggle; dispose puts them back.
  const format = byId("setting-underline-format"),
    boutenSetting = byId("setting-bouten"),
    levelSettings = byId("setting-heading-levels"),
    childHome = format.parentElement!;
  byId("children-convertUnderline").prepend(format);
  byId("children-convertBouten").prepend(boutenSetting);
  byId("children-convertHeadings").prepend(levelSettings);
  const levelSelects = new Map<keyof HeadingLevels, HTMLSelectElement>();
  for (const select of levelSettings.querySelectorAll<HTMLSelectElement>(
    "select[data-level-key]",
  )) {
    const key = select.dataset.levelKey as keyof HeadingLevels;
    select.replaceChildren(
      ...([1, 2, 3, 4, 5, 6] as const).map((level) => {
        const option = el("option", `${level}（${"#".repeat(level)}）`);
        option.value = String(level);
        return option;
      }),
    );
    levelSelects.set(key, select);
    on(select, "change", () =>
      headingLevel(key, Number(select.value) as HeadingLevel),
    );
  }
  // History navigation must not restore stale control state over a fresh model.
  for (const control of root.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("input, select"))
    control.autocomplete = "off";
  const extensionRadios = [
    byId<HTMLInputElement>("output-extension-md"),
    byId<HTMLInputElement>("output-extension-txt"),
  ];
  for (const radio of extensionRadios)
    on(radio, "change", () => {
      if (radio.checked)
        controller.changeSettings({
          ...controller.state.settings,
          outputExtension: radio.value as "md" | "txt",
        });
    });
  for (const topic of HELP_TOPICS) {
    const summary = root.getElementById("summary-" + topic.id);
    if (summary && topic.control !== "boolean")
      summary.textContent = topic.summary;
    const named = root.querySelector(`[data-label-for="${topic.id}"]`);
    if (named) named.textContent = topic.label;
    const help = root.querySelector(`[data-help-for="${topic.id}"]`);
    if (help) {
      help.setAttribute(
        "aria-label",
        topic.id === "usage"
          ? "使い方"
          : topic.id === "preview-vertical-ops"
            ? topic.label
            : `${topic.label}の説明`,
      );
      help.setAttribute("aria-controls", "help-popover");
      help.setAttribute("aria-expanded", "false");
    }
    const host = root.querySelector(`[data-help-host="${topic.id}"]`);
    const primary = host?.querySelector("button:not(.help), input, select");
    if (
      primary instanceof HTMLElement &&
      !primary.hasAttribute("data-described-summary") &&
      summary
    ) {
      primary.setAttribute("data-described-summary", summary.id);
      primary.setAttribute("data-setting-id", topic.id);
    }
  }
  byId("picker-formats").textContent = PICKER_FORMATS;
  byId("picker-replace").textContent = PICKER_REPLACE;
  byId("details-brief").textContent = DETAILS_BRIEF;
  const advanced = byId<HTMLDetailsElement>("advanced");
  const syncDetailsLabel = () => {
    byId("details-title").textContent = advanced.open
      ? DETAILS_CLOSE_LABEL
      : DETAILS_OPEN_LABEL;
  };
  on(advanced, "toggle", syncDetailsLabel);
  const detailsObserver = new MutationObserver(syncDetailsLabel);
  detailsObserver.observe(advanced, {
    attributes: true,
    attributeFilter: ["open"],
  });
  syncDetailsLabel();
  const files = byId<HTMLInputElement>("files"),
    pick = byId<HTMLButtonElement>("pick-files");
  on(pick, "click", () => {
    if (pick.disabled) return;
    files.click();
  });
  on(files, "change", () => {
    controller.selectFiles(Array.from(files.files ?? []));
    files.value = "";
  });
  on(files, "cancel", () => {
    /* Cancellation is not a new selection. The visible count stays on the controller list. */
  });
  const encoding = byId<HTMLSelectElement>("encoding"),
    organize = byId<HTMLInputElement>("organize"),
    underline = byId<HTMLSelectElement>("underline"),
    bouten = byId<HTMLInputElement>("bouten"),
    deliverySingle = byId<HTMLInputElement>("delivery-single"),
    deliveryZip = byId<HTMLInputElement>("delivery-zip");
  on(encoding, "change", () =>
    controller.changeSettings({
      ...controller.state.settings,
      encoding: encoding.value as typeof controller.state.settings.encoding,
    }),
  );
  on(organize, "change", () =>
    controller.changeSettings({
      ...controller.state.settings,
      organizeByAuthor: organize.checked,
    }),
  );
  on(underline, "change", () =>
    conversion("underlineOutputFormat", underline.value),
  );
  on(bouten, "input", () => conversion("boutenChar", bouten.value));
  on(deliverySingle, "change", () => {
    if (deliverySingle.checked) controller.setDelivery("single");
  });
  on(deliveryZip, "change", () => {
    if (deliveryZip.checked) controller.setDelivery("zip");
  });
  button("start", () => {
    void controller.startImport();
  });
  button("cancel", () => controller.cancel());
  button("clear", () => controller.clear());
  button("reset", () => controller.resetSettings());
  button("select-all", () => controller.selectAll(true));
  button("select-none", () => controller.selectAll(false));
  button("create-output", () => {
    void controller.prepare(controller.state.delivery);
  });
  button("download", () => controller.requestDownload());
  const limits = DEFAULT_IMPORT_LIMITS;
  byId("limits").textContent =
    `入力は${limits.sources}個まで・1入力${limits.inputBytes / 1048576} MiBまで・合計${limits.totalInputBytes / 1048576} MiBまで。本文は単体・ZIP内とも1件${limits.textBytes / 1048576} MiBまで。`;
  let pinned: string | undefined,
    passClick = false,
    suppressNativeClick = false,
    suppressTimer = 0;
  const autoClose = createHelpAutoClose(window);
  let press:
    | {
        id: number;
        target: HTMLInputElement;
        x: number;
        y: number;
        lastX: number;
        lastY: number;
        moved: boolean;
        type: string;
      }
    | undefined;
  const pressSlop = 10;
  const releasePress = (event: PointerEvent, cancel: boolean) => {
    const current = press;
    if (!current || current.id !== event.pointerId) return;
    press = undefined;
    window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressNativeClick = false;
    }, 0);
    if (cancel || current.moved || current.target.disabled) return;
    const box = current.target.getBoundingClientRect();
    const releasedOnControl =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!releasedOnControl) return;
    passClick = true;
    current.target.click();
    passClick = false;
  };
  const popover = () => byId("help-popover");
  const closeHelpUi = () => {
    autoClose.cancel();
    pinned = undefined;
    if (controller.state.helpTopic) controller.closeHelp();
    else renderHelp();
  };
  const showHelp = (id: string) => {
    pinned = id;
    autoClose.restart(closeHelpUi);
    if (controller.state.helpTopic === id) renderHelp();
    else controller.openHelp(id);
  };
  const anchorShown = (anchor: HTMLElement | null) => {
    if (!anchor?.isConnected) return false;
    for (let node: HTMLElement | null = anchor; node; node = node.parentElement)
      if (node.hidden) return false;
    return true;
  };
  const renderHelp = () => {
    const pop = popover(),
      topic = controller.state.helpTopic,
      spec = topic ? helpTopic(topic) : undefined,
      anchor = topic
        ? (root.querySelector(
            `[data-help-for="${topic}"]`,
          ) as HTMLElement | null)
        : null;
    if (topic && !anchorShown(anchor)) {
      closeHelpUi();
      return;
    }
    for (const control of root.querySelectorAll("[data-described-summary]")) {
      const base = control.getAttribute("data-described-summary") ?? "",
        setting = control.getAttribute("data-setting-id");
      control.setAttribute(
        "aria-describedby",
        setting && setting === topic ? `${base} help-popover` : base,
      );
    }
    for (const help of root.querySelectorAll(".help")) {
      help.setAttribute(
        "aria-expanded",
        help.getAttribute("data-help-for") === topic ? "true" : "false",
      );
    }
    if (!spec) {
      pop.hidden = true;
      pop.textContent = "";
      return;
    }
    pop.hidden = false;
    pop.textContent = spec.detail;
    if (anchor) placePopover(pop, anchor);
  };
  for (const help of root.querySelectorAll<HTMLButtonElement>(".help")) {
    on(help, "click", (event) => {
      const id = help.dataset.helpFor;
      if (!id || help.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      if (pinned === id) closeHelpUi();
      else showHelp(id);
    });
  }
  on(
    root,
    "pointermove",
    (event) => {
      const point = event as PointerEvent;
      if (!press || press.id !== point.pointerId) return;
      if (
        !press.moved &&
        Math.hypot(point.clientX - press.x, point.clientY - press.y) <=
          pressSlop
      )
        return;
      const previousX = press.lastX,
        previousY = press.lastY;
      press.moved = true;
      press.lastX = point.clientX;
      press.lastY = point.clientY;
      if (press.type !== "touch") return;
      root.scrollingElement?.scrollBy(
        previousX - point.clientX,
        previousY - point.clientY,
      );
    },
    { capture: true },
  );
  on(
    root,
    "pointerup",
    (event) => {
      releasePress(event as PointerEvent, false);
    },
    { capture: true },
  );
  on(
    root,
    "pointercancel",
    (event) => {
      releasePress(event as PointerEvent, true);
    },
    { capture: true },
  );
  on(
    root,
    "pointerdown",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        (target.type === "checkbox" || target.type === "radio") &&
        !target.disabled &&
        (event as PointerEvent).button === 0
      ) {
        const point = event as PointerEvent;
        event.preventDefault();
        event.stopPropagation();
        target.focus({ preventScroll: true });
        window.clearTimeout(suppressTimer);
        suppressNativeClick = true;
        press = {
          id: point.pointerId,
          target,
          x: point.clientX,
          y: point.clientY,
          lastX: point.clientX,
          lastY: point.clientY,
          moved: false,
          type: point.pointerType,
        };
        return;
      }
    },
    { capture: true },
  );
  on(
    root,
    "click",
    (event) => {
      if (passClick || (event as MouseEvent).detail === 0) return;
      const target = event.target;
      if (
        suppressNativeClick &&
        target instanceof HTMLInputElement &&
        (target.type === "checkbox" || target.type === "radio")
      )
        event.preventDefault();
    },
    { capture: true },
  );
  on(root, "click", (event) => {
    if (!pinned) return;
    const target = event.target;
    if (!(target instanceof Node) || popover().contains(target)) return;
    if (target instanceof Element && target.closest(".help")) return;
    closeHelpUi();
  });
  on(root, "keydown", (event) => {
    if (
      (event as KeyboardEvent).key !== "Escape" ||
      !controller.state.helpTopic
    )
      return;
    closeHelpUi();
    event.preventDefault();
    event.stopPropagation();
  });
  const reposition = () => {
    if (controller.state.helpTopic) renderHelp();
  };
  on(window, "resize", reposition);
  on(window, "scroll", reposition, { capture: true });
  let lastFiles = controller.state.files,
    lastDelivered = controller.state.delivered,
    lastInputPage = -1,
    lastPage = -1,
    lastDiagnostic = -1,
    lastDetail = "",
    lastNotes = -1,
    lastConversion = -1;
  const resultChecks = new Map<string, HTMLInputElement>();
  const previewButtons = new Map<string, HTMLButtonElement>(),
    previewMarks = new Map<string, HTMLElement>();
  const previewDom: PreviewDom<HTMLElement, Text> = {
    createElement: (tag) => root.createElement(tag),
    createTextNode: (text) => root.createTextNode(text),
    append: (parent, node) => {
      parent.append(node);
    },
    setClass: (element, className) => {
      element.className = className;
    },
    setAttribute: (element, name, value) => {
      element.setAttribute(name, value);
    },
  };
  const surface = byId("preview-surface"),
    sourceText = byId("source-text"),
    tabs = [
      byId<HTMLButtonElement>("preview-tab-preview"),
      byId<HTMLButtonElement>("preview-tab-source"),
    ];
  const tabName = (tab: HTMLButtonElement): PreviewTab =>
    tab.id === "preview-tab-source" ? "source" : "preview";
  controller.preview.attach({
    async render(model, isCurrent) {
      const r = await renderPreview(model, previewDom, {
        cancelled: () => !isCurrent(),
      });
      if (r.status === "done" && isCurrent()) {
        surface.replaceChildren(r.root);
        toModeStart();
        return { result: "done", nodes: r.nodes };
      }
      return { result: r.status === "limit" ? "limit" : "cancelled" };
    },
    clear() {
      surface.replaceChildren();
    },
  });
  for (const tab of tabs) {
    on(tab, "click", () => controller.setPreviewTab(tabName(tab)));
    on(tab, "keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      const index = tabs.indexOf(tab);
      const next =
        key === "ArrowRight" || key === "ArrowLeft"
          ? (index + 1) % tabs.length
          : key === "Home"
            ? 0
            : key === "End"
              ? tabs.length - 1
              : -1;
      if (next < 0) return;
      event.preventDefault();
      controller.setPreviewTab(tabName(tabs[next]));
      tabs[next].focus();
    });
  }
  button("preview-close", () => {
    const id = controller.preview.view.target?.fileId;
    controller.closePreview();
    const back = id ? previewButtons.get(id) : undefined;
    if (back?.isConnected) back.focus();
    else byId("result-summary").focus();
  });
  const modeButtons: Record<PreviewMode, HTMLButtonElement> = {
    horizontal: byId("preview-mode-horizontal"),
    vertical: byId("preview-mode-vertical"),
  };
  for (const mode of ["horizontal", "vertical"] as const)
    on(modeButtons[mode], "click", () => controller.setPreviewMode(mode));
  const faceButtons: Record<PreviewFace, HTMLButtonElement> = {
    gothic: byId("preview-face-gothic"),
    mincho: byId("preview-face-mincho"),
  };
  for (const face of ["gothic", "mincho"] as const)
    on(faceButtons[face], "click", () => controller.setPreviewFace(face));
  const isVertical = () => surface.classList.contains("preview-vertical");
  const lineStep = () => parseFloat(getComputedStyle(surface).lineHeight) || 28;
  function toModeStart() {
    surface.scrollTop = 0;
    if (isVertical()) toVerticalStart(surface);
    else surface.scrollLeft = 0;
  }
  /** A horizontal island that can still scroll vertically keeps the wheel. */
  function innerScrolls(target: EventTarget | null, deltaY: number) {
    for (
      let node = target instanceof Element ? target : null;
      node && node !== surface;
      node = node.parentElement
    ) {
      if (node.scrollHeight <= node.clientHeight) continue;
      const overflow = getComputedStyle(node).overflowY;
      if (overflow !== "auto" && overflow !== "scroll") continue;
      if (deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight)
        return true;
      if (deltaY < 0 && node.scrollTop > 0) return true;
    }
    return false;
  }
  on(
    surface,
    "wheel",
    (event) => {
      const wheel = event as WheelEvent;
      if (!isVertical() || innerScrolls(wheel.target, wheel.deltaY)) return;
      const move = wheelAdvance(wheel, surface, lineStep());
      if (move !== undefined && applyAdvance(surface, move))
        wheel.preventDefault();
    },
    { passive: false },
  );
  on(surface, "keydown", (event) => {
    if (!isVertical() || event.target !== surface) return;
    const move = keyAdvance(event as KeyboardEvent, surface, lineStep());
    if (move !== undefined && applyAdvance(surface, move))
      event.preventDefault();
  });
  let lastMode: PreviewMode | undefined;
  function applyMode(mode: PreviewMode) {
    const vertical = mode === "vertical";
    for (const m of ["horizontal", "vertical"] as const)
      modeButtons[m].setAttribute("aria-pressed", String(m === mode));
    byId("preview-mode-hint").textContent = MODE_HINT_TEXT[mode];
    byId<HTMLButtonElement>("preview-vertical-ops").hidden = !vertical;
    if (mode === lastMode) return;
    lastMode = mode;
    surface.classList.toggle("preview-vertical", vertical);
    if (vertical) {
      surface.tabIndex = 0;
      surface.setAttribute("role", "region");
      surface.setAttribute("aria-label", "縦書きのプレビュー本文");
    } else {
      surface.removeAttribute("tabindex");
      surface.removeAttribute("role");
      surface.removeAttribute("aria-label");
    }
    toModeStart();
  }
  function applyFace(face: PreviewFace) {
    for (const name of ["gothic", "mincho"] as const)
      faceButtons[name].setAttribute("aria-pressed", String(name === face));
    surface.classList.toggle("preview-mincho", face === "mincho");
  }
  button("preview-retry", () => controller.retryPreview());
  button("preview-show-source", () => {
    controller.setPreviewTab("source");
    tabs[1].focus();
  });
  let lastSource: object | undefined;
  function renderPreviewPanel() {
    const view = controller.preview.view,
      target = view.target,
      busy = !!controller.state.active;
    for (const [id, b] of previewButtons) {
      b.disabled = busy;
      previewMarks.get(id)!.hidden = id !== target?.fileId;
    }
    byId("preview").hidden = !target;
    byId("preview").dataset.status = view.status;
    byId("preview").dataset.mode = view.mode;
    byId("preview").dataset.face = view.face;
    applyMode(view.mode);
    applyFace(view.face);
    if (!target) {
      lastSource = undefined;
      sourceText.textContent = "";
      byId("source-status").textContent = "";
      byId("preview-status").textContent = "";
      byId("preview-note-list").replaceChildren();
      return;
    }
    byId("preview-target").textContent =
      `閲覧中: ${target.relativePath}（.${target.format} · ${bytes(target.bytes.byteLength)}）`;
    const source = view.tab === "source";
    tabs.forEach((tab, index) => {
      const selected = (index === 1) === source;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    byId("preview-panel-preview").hidden = source;
    byId("preview-panel-source").hidden = !source;
    byId("preview-status").textContent = previewStatusText(view);
    const retry = byId<HTMLButtonElement>("preview-retry");
    retry.hidden = !["failed", "timeout", "cancelled"].includes(view.status);
    retry.disabled = busy;
    byId("preview-show-source").hidden = ![
      "limit",
      "failed",
      "timeout",
    ].includes(view.status);
    byId("preview-notes").hidden = !view.notices.length;
    byId("preview-note-list").replaceChildren(
      ...noticeTexts(view.notices, view.mode).map((text) => el("li", text)),
    );
    if (source && lastSource !== target.artifact) {
      const window = sourceWindow(target.bytes);
      sourceText.textContent = window.text;
      byId("source-status").textContent = sourceStatusText(window);
      lastSource = target.artifact;
    } else if (!source && lastSource !== target.artifact) {
      sourceText.textContent = "";
      lastSource = undefined;
    }
  }
  function pager(
    id: string,
    total: number,
    page: number,
    key:
      | "inputPage"
      | "resultPage"
      | "diagnosticPage"
      | "notePage"
      | "conversionPage",
  ) {
    const nav = byId(id),
      pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (nav.children.length && nav.dataset.page === `${page}:${total}`) return;
    nav.dataset.page = `${page}:${total}`;
    if (!nav.children.length) {
      const previous = el("button", "前のページ"),
        label = el("span"),
        next = el("button", "次のページ");
      previous.type = next.type = "button";
      on(previous, "click", () =>
        controller.setPage(key, controller.state[key] - 1),
      );
      on(next, "click", () =>
        controller.setPage(key, controller.state[key] + 1),
      );
      nav.append(previous, label, next);
    }
    (nav.children[0] as HTMLButtonElement).disabled = page <= 0;
    (nav.children[2] as HTMLButtonElement).disabled = page >= pages - 1;
    nav.children[1].textContent = `${page + 1} / ${pages}ページ · 全${total}件`;
    nav.hidden = total <= PAGE_SIZE;
  }
  function diagnostic(
    code: string,
    severity: string,
    subject: string,
    details: string,
    raw?: { reason?: unknown },
  ) {
    const li = el("li");
    li.append(
      el("span", severityLabel(severity)),
      el("p", subject),
      el("p", explain(code, raw)),
      el("code", code),
    );
    li.firstElementChild!.className = "severity";
    const d = el("details");
    d.append(el("summary", "詳細情報"), el("pre", details));
    li.append(d);
    return li;
  }
  const subject = (inputId: string, entryIndex?: number) => {
    const index = controller.state.files.findIndex((f) => f.id === inputId);
    const input =
      index >= 0
        ? `入力${index + 1}: ${controller.state.files[index].file.name}`
        : inputId || "バッチ全体";
    return `${input}${entryIndex === undefined ? "" : ` · ZIP entryIndex ${entryIndex}（0始まり）`}`;
  };
  function render(change: Change) {
    if (change === "help") {
      renderHelp();
      return;
    }
    if (change === "preview") {
      renderPreviewPanel();
      // Keyboard tab moves do not pass through the outside-click closer.
      // A hidden anchor (source tab, horizontal mode) must still drop help.
      renderHelp();
      return;
    }
    const s = controller.state,
      busy = !!s.active,
      artifacts = controller.artifacts;
    byId("progress-area").hidden = !busy;
    byId("progress").textContent = s.progress;
    if (change === "progress") return;
    byId("boot-error").hidden = s.available;
    byId("status").textContent = s.message;
    const picker = fileSelectionPresentation(s.files.length);
    pick.disabled = files.disabled = busy || !s.available;
    pick.textContent = picker.action;
    byId("file-selection-status").textContent = picker.status;
    byId<HTMLButtonElement>("clear").disabled =
      !s.files.length && !s.delivered && !busy;
    byId<HTMLButtonElement>("cancel").disabled = !busy;
    byId<HTMLButtonElement>("start").disabled = !controller.canImport;
    byId<HTMLButtonElement>("reset").disabled = busy || !s.available;
    byId<HTMLFieldSetElement>("basic-settings").disabled = busy || !s.available;
    byId<HTMLFieldSetElement>("advanced-settings").disabled =
      busy || !s.available;
    encoding.value = s.settings.encoding;
    organize.checked = s.settings.organizeByAuthor;
    underline.value = s.settings.conversion.underlineOutputFormat;
    bouten.value = s.settings.conversion.boutenChar;
    underline.disabled = busy || !s.settings.conversion.convertUnderline;
    bouten.disabled = busy || !s.settings.conversion.convertBouten;
    for (const [key, select] of levelSelects) {
      select.value = String(s.settings.conversion.headingLevels[key]);
      select.disabled = busy || !s.settings.conversion.convertHeadings;
    }
    for (const radio of extensionRadios)
      radio.checked = radio.value === s.settings.outputExtension;
    const noContent = isNoContentConversion(s.settings.conversion);
    byId("conversion-mode").hidden = !noContent;
    byId("conversion-mode").textContent = noContent
      ? NO_CONTENT_CONVERSION
      : "";
    for (const option of BOOLEAN_CONTROLS) {
      const input = controls.get(option.key)!;
      input.checked = Boolean(s.settings.conversion[option.key]);
      input.disabled =
        busy || !!(option.parent && !s.settings.conversion[option.parent]);
    }
    if (
      lastFiles !== s.files ||
      lastInputPage !== s.inputPage ||
      change === "clear"
    ) {
      const list = byId("inputs");
      list.replaceChildren();
      const issues = selectionIssues(s.files);
      for (const [index, f] of pageOf(s.files, s.inputPage).entries()) {
        const i = s.inputPage * PAGE_SIZE + index;
        const li = el("li"),
          info = el("div"),
          remove = el("button", "削除");
        info.append(
          el("span", f.file.name),
          el("p", `入力${i + 1} · ${bytes(f.file.size)}`),
        );
        info.lastElementChild!.className = "hint";
        for (const issue of issues.filter((x) => x.inputId === f.id))
          info.append(el("p", issue.text));
        remove.type = "button";
        remove.setAttribute(
          "aria-label",
          `${f.file.name}（入力${i + 1}）を削除`,
        );
        remove.onclick = () => {
          controller.removeFile(f.id);
          pick.focus();
        };
        li.append(info, remove);
        list.append(li);
      }
      byId("input-count").textContent = s.files.length
        ? `入力 ${s.files.length}件 · 合計 ${bytes(s.files.reduce((n, f) => n + f.file.size, 0))}`
        : "入力はまだありません。";
      byId("input-issues").replaceChildren(
        ...issues.filter((x) => !x.inputId).map((x) => el("li", x.text)),
      );
      lastFiles = s.files;
      lastInputPage = s.inputPage;
    }
    pager("input-pages", s.files.length, s.inputPage, "inputPage");
    for (const b of byId("inputs").querySelectorAll("button"))
      b.disabled = busy;
    const changed = lastDelivered !== s.delivered;
    const stats = s.delivered?.stats;
    const resultSummary = byId("result-summary");
    if (stats) {
      resultSummary.replaceChildren(
        `出力 ${stats.artifactFiles}件 · 失敗した入力 `,
        attentionCount(stats.errors, "件", "error"),
        ` · ${REMAINING_NOTES_LABEL} `,
        attentionCount(stats.remainingNotes, "箇所", "note"),
      );
    } else {
      resultSummary.textContent = "変換後の出力がここに表示されます。";
    }
    const outcomes = s.delivered?.result.outcomes ?? [];
    byId("outcomes").textContent = stats
      ? `処理対象外の入力 ${outcomes.filter((o) => o.status === "ignored" && o.entryIndex === undefined).length}件 · 対象外ZIP entry ${outcomes.filter((o) => o.status === "ignored" && o.entryIndex !== undefined).length}件 · 空ZIP ${outcomes.filter((o) => o.status === "empty").length}件。母数が異なるため、合算しません。`
      : "";
    if (changed || lastPage !== s.resultPage) {
      const list = byId("results");
      list.replaceChildren();
      resultChecks.clear();
      previewButtons.clear();
      previewMarks.clear();
      for (const a of pageOf(artifacts, s.resultPage)) {
        const li = el("li"),
          content = el("div"),
          label = el("label"),
          check = el("input"),
          actions = el("div"),
          preview = el("button", "プレビュー"),
          mark = el("p", "閲覧中"),
          details = el("button", "警告・注記を確認");
        check.type = "checkbox";
        check.setAttribute("aria-label", `出力を選択: ${a.relativePath}`);
        label.append(check, el("span", a.relativePath));
        const meta = el("p");
        meta.append(
          `.${a.format} · ${bytes(a.bytes.byteLength)} · ${REMAINING_NOTES_LABEL} `,
          attentionCount(a.conversion.remainingNotes.length, "箇所", "note"),
        );
        content.append(
          label,
          meta,
          el("p", `元入力: ${subject(a.source.inputId, a.source.entryIndex)}`),
          mark,
        );
        content.children[1].className = content.children[2].className =
          "result-meta";
        mark.className = "result-meta viewing-mark";
        mark.hidden = true;
        preview.type = "button";
        preview.setAttribute("aria-label", `${a.relativePath}をプレビュー`);
        preview.onclick = () => {
          if (controller.openPreview(a.fileId)) byId("preview-title").focus();
        };
        previewButtons.set(a.fileId, preview);
        previewMarks.set(a.fileId, mark);
        actions.className = "result-actions";
        check.onchange = () => controller.setSelected(a.fileId, check.checked);
        resultChecks.set(a.fileId, check);
        details.type = "button";
        details.setAttribute(
          "aria-label",
          `${a.relativePath}の警告・注記を確認`,
        );
        details.onclick = () => {
          controller.showDetail(a.fileId);
          byId("detail-title").focus();
        };
        actions.append(preview, details);
        li.append(content, actions);
        list.append(li);
      }
      lastPage = s.resultPage;
    }
    for (const [id, input] of resultChecks) {
      input.checked = s.selected.has(id);
      input.disabled = busy;
    }
    byId<HTMLButtonElement>("select-all").disabled = busy || !artifacts.length;
    byId<HTMLButtonElement>("select-none").disabled = busy || !artifacts.length;
    byId("selection-count").textContent =
      `選択 ${s.selected.size}件 / 出力 ${artifacts.length}件`;
    pager("result-pages", artifacts.length, s.resultPage, "resultPage");
    const diagnostics = s.delivered?.result.diagnostics ?? [];
    byId("import-diagnostic-count").textContent =
      `入力診断 ${diagnostics.length}件`;
    if (changed || lastDiagnostic !== s.diagnosticPage) {
      byId("import-diagnostic-list").replaceChildren(
        ...pageOf(diagnostics, s.diagnosticPage).map((d) =>
          diagnostic(
            d.code,
            d.severity,
            subject(d.inputId, d.entryIndex),
            `段階: ${d.stage}\nreason: ${d.reason}`,
          ),
        ),
      );
      lastDiagnostic = s.diagnosticPage;
    }
    pager(
      "diagnostic-pages",
      diagnostics.length,
      s.diagnosticPage,
      "diagnosticPage",
    );
    const detail = artifacts.find((a) => a.fileId === s.detailId);
    byId("detail").hidden = !detail;
    if (
      detail &&
      (changed ||
        lastDetail !== detail.fileId ||
        lastNotes !== s.notePage ||
        lastConversion !== s.conversionPage)
    ) {
      byId("detail-title").textContent = detail.relativePath;
      byId("conversion-count").textContent =
        `変換診断 ${detail.conversion.diagnostics.length}件`;
      byId("conversion-list").replaceChildren(
        ...pageOf(detail.conversion.diagnostics, s.conversionPage).map((d) =>
          diagnostic(
            d.code,
            d.severity,
            `変換段階: ${d.stage}`,
            `${d.range ? `元入力のUTF-16位置: ${d.range.startUtf16}〜${d.range.endUtf16}\n` : ""}${JSON.stringify(d.details, null, 2)}`,
            d.details,
          ),
        ),
      );
      byId("note-count").textContent =
        `${REMAINING_NOTES_LABEL} ${detail.conversion.remainingNotes.length}箇所`;
      byId("notes").replaceChildren(
        ...pageOf(detail.conversion.remainingNotes, s.notePage).map((n) => {
          const li = el("li");
          li.append(el("strong", `出力 ${n.line}行`), el("pre", n.text));
          return li;
        }),
      );
      pager(
        "conversion-pages",
        detail.conversion.diagnostics.length,
        s.conversionPage,
        "conversionPage",
      );
      pager(
        "note-pages",
        detail.conversion.remainingNotes.length,
        s.notePage,
        "notePage",
      );
      lastDetail = detail.fileId;
      lastNotes = s.notePage;
      lastConversion = s.conversionPage;
    } else if (!detail) {
      byId("notes").replaceChildren();
      byId("conversion-list").replaceChildren();
      byId("detail-title").textContent = "";
      lastDetail = "";
    }
    const selected = controller.selectedArtifacts.length;
    const mode = s.delivery;
    byId("delivery-guidance").hidden = selected !== 0;
    byId("delivery-single-choice").hidden = selected !== 1;
    byId("delivery-zip-choice").hidden = selected === 0;
    deliverySingle.checked = mode === "single";
    deliveryZip.checked = mode === "zip";
    deliverySingle.disabled = busy || !s.available || selected !== 1;
    deliveryZip.disabled = busy || !s.available || selected === 0;
    const create = byId<HTMLButtonElement>("create-output");
    create.textContent = deliveryButtonLabel(mode, selected);
    create.disabled =
      busy ||
      !s.available ||
      selected === 0 ||
      (mode === "single" && selected !== 1);
    const chosen = controller.selectedArtifacts[0];
    byId("delivery-target").textContent =
      selected === 0
        ? ""
        : mode === "single" && chosen
          ? `対象: ${chosen.relativePath.split(/[/\\]/u).pop()}（1件。フォルダ名は付きません）`
          : `対象: ${selected}件。フォルダ構成はZIPの中に残ります。`;
    const exported = s.exported;
    byId("export-errors").replaceChildren(
      ...(exported?.diagnostics ?? []).map((d) =>
        diagnostic(
          d.code,
          d.severity,
          d.fileId ?? "選択した出力",
          `reason: ${d.reason}`,
        ),
      ),
    );
    const ready = exported?.status === "ready";
    byId("ready").hidden = !ready;
    byId<HTMLButtonElement>("download").disabled = busy || !ready;
    byId("export-status").textContent = ready
      ? "作成できました。下のボタンでダウンロードを開始できます。"
      : exported?.status === "failed"
        ? "作成に失敗しました。変換結果と選択は保持しています。"
        : exported?.status === "cancelled"
          ? "作成を中止しました。変換結果と選択は保持しています。"
          : s.active?.kind === "export"
            ? "出力を作成しています。"
            : selected === 0
              ? "出力を選ぶと、受け取り方法を選べます。"
              : "作成しても、ダウンロードは自動では始まりません。";
    byId("ready-name").textContent = ready ? exported.filename : "";
    byId("ready-size").textContent = ready
      ? `${exported.manifest.length}件 · ${bytes(exported.blob.size)}`
      : "";
    byId("download-message").textContent = s.downloadMessage;
    byId("download-count").textContent = controller.downloads.count
      ? `受け付けたダウンロード ${controller.downloads.count} / 8件。通常は約60秒で受付を終えます。`
      : "";
    lastDelivered = s.delivered;
    renderPreviewPanel();
    renderHelp();
    if (change === "result" || change === "cancel")
      byId("result-summary").focus();
    if (change === "clear") pick.focus();
    if (change === "prepared") byId("export-status").focus();
  }
  const unsubscribe = controller.subscribe(render);
  lastFiles = [];
  render("state");
  return () => {
    unsubscribe();
    controller.preview.attach(undefined);
    surface.replaceChildren();
    lastMode = undefined;
    surface.classList.remove("preview-vertical", "preview-mincho");
    for (const name of ["tabindex", "role", "aria-label"])
      surface.removeAttribute(name);
    sourceText.textContent = "";
    previewButtons.clear();
    previewMarks.clear();
    detailsObserver.disconnect();
    autoClose.cancel();
    window.clearTimeout(suppressTimer);
    listeners.abort();
    childHome.append(format, boutenSetting, levelSettings);
    for (const id of [
      "basic-booleans",
      "body-controls",
      "decoration-controls",
      "nyoze-controls",
    ])
      byId(id).replaceChildren();
    for (const id of [
      "inputs",
      "results",
      "import-diagnostic-list",
      "conversion-list",
      "notes",
      "input-pages",
      "result-pages",
      "diagnostic-pages",
      "conversion-pages",
      "note-pages",
    ]) {
      byId(id).replaceChildren();
      delete byId(id).dataset.page;
    }
    popover().hidden = true;
    popover().textContent = "";
  };
}
function placePopover(pop: HTMLElement, anchor: HTMLElement) {
  const margin = 8,
    gap = 8,
    vw = window.innerWidth,
    vh = window.innerHeight,
    anchorBox = anchor.getBoundingClientRect(),
    width = Math.min(352, Math.max(120, vw - margin * 2));
  pop.style.position = "fixed";
  pop.style.height = "auto";
  pop.style.left = "0px";
  pop.style.top = "0px";
  pop.style.width = `${width}px`;
  pop.style.maxWidth = `${width}px`;
  pop.style.maxHeight = "240px";
  const content = Math.min(
    240,
    Math.max(1, Math.ceil(pop.getBoundingClientRect().height)),
  );
  let left = Math.round(anchorBox.left);
  left = Math.min(
    Math.max(margin, left),
    Math.max(margin, vw - margin - width),
  );
  const buttonTop = Math.min(Math.max(anchorBox.top, margin), vh - margin),
    buttonBottom = Math.max(Math.min(anchorBox.bottom, vh - margin), buttonTop),
    spaceBelow = Math.max(0, vh - margin - buttonBottom - gap),
    spaceAbove = Math.max(0, buttonTop - margin - gap),
    placeBelow =
      spaceBelow >= content ||
      (spaceBelow >= spaceAbove && spaceAbove < content);
  let height = Math.min(content, placeBelow ? spaceBelow : spaceAbove);
  if (height < 1) height = 1;
  let top = placeBelow ? buttonBottom + gap : buttonTop - gap - height;
  if (placeBelow) {
    if (top + height > vh - margin) height = Math.max(1, vh - margin - top);
  } else if (top < margin) {
    height = Math.max(1, height - (margin - top));
    top = margin;
  }
  const aboveLimit = buttonTop - gap;
  if (!placeBelow && top + height > aboveLimit)
    height = Math.max(1, aboveLimit - top);
  pop.style.maxHeight = `${Math.floor(height)}px`;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}
