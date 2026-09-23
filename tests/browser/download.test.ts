import { afterEach, expect, it, vi } from "vitest";
import {
  createDownloadHandle,
  type DownloadHost,
} from "../../src/adapters/browser/download.js";
function fakeHost() {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const host: DownloadHost = {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
    createAnchor: vi.fn(() => anchor),
    appendAnchor: vi.fn(),
    setTimer: vi.fn((fn, ms) => setTimeout(fn, ms)),
    clearTimer: vi.fn((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
  };
  return { host, anchor };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("S3-06 deferred synchronous single request, cleanup exactly at 60s", () => {
  vi.useFakeTimers();
  const { host, anchor } = fakeHost();
  const h = createDownloadHandle(new Blob(["x"]), "題.md", host);
  expect(h.state).toBe("ready");
  expect(host.createObjectURL).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(h.request()).toEqual({ status: "requested" });
  expect(anchor.href).toBe("blob:test");
  expect(anchor.download).toBe("題.md");
  expect(anchor.click).toHaveBeenCalledTimes(1);
  expect(anchor.remove).toHaveBeenCalledTimes(1);
  expect(h.request()).toMatchObject({
    status: "failed",
    diagnostic: { code: "ALREADY_REQUESTED" },
  });
  expect(anchor.click).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(59999);
  expect(host.revokeObjectURL).not.toHaveBeenCalled();
  expect(h.state).toBe("requested");
  vi.advanceTimersByTime(1);
  expect(h.state).toBe("disposed");
  expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  h.dispose();
  h.dispose();
  expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
  expect(h.request()).toMatchObject({ diagnostic: { code: "DISPOSED" } });
});
it("dispose before/after request and fresh handle re-download", () => {
  vi.useFakeTimers();
  const { host, anchor } = fakeHost(),
    blob = new Blob(["x"]);
  const early = createDownloadHandle(blob, "x.txt", host);
  early.dispose();
  expect(early.request()).toMatchObject({ diagnostic: { code: "DISPOSED" } });
  expect(host.createObjectURL).not.toHaveBeenCalled();
  const h = createDownloadHandle(blob, "x.txt", host);
  h.request();
  h.dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
  const again = createDownloadHandle(blob, "x.txt", host);
  again.request();
  expect(anchor.click).toHaveBeenCalledTimes(2);
  again.dispose();
  expect(host.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it.each(["url", "anchor", "append", "click", "timer"])(
  "exception %s cleans created resources",
  (fault) => {
    vi.useFakeTimers();
    const { host, anchor } = fakeHost();
    const fail = () => {
      throw Error("fault");
    };
    if (fault === "url") host.createObjectURL = vi.fn(fail);
    if (fault === "anchor") host.createAnchor = vi.fn(fail);
    if (fault === "append") host.appendAnchor = vi.fn(fail);
    if (fault === "click") anchor.click = vi.fn(fail);
    if (fault === "timer") host.setTimer = vi.fn(fail);
    const h = createDownloadHandle(new Blob(["x"]), "x.zip", host);
    expect(h.request().status).toBe("failed");
    expect(h.state).toBe("failed");
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(fault === "url" ? 0 : 1);
    expect(anchor.remove).toHaveBeenCalledTimes(
      ["url", "anchor"].includes(fault) ? 0 : 1,
    );
    expect(vi.getTimerCount()).toBe(0);
    h.dispose();
    expect(host.revokeObjectURL).toHaveBeenCalledTimes(fault === "url" ? 0 : 1);
  },
);
it.each([
  "../a.md",
  "a.md/",
  "CON.md",
  "a.MD",
  "a\ud800.md",
  "https://example.com/a.zip",
])("invalid name %s cannot create URL", (name) => {
  const { host } = fakeHost();
  const h = createDownloadHandle(new Blob(["x"]), name, host);
  expect(h.state).toBe("failed");
  expect(h.request().status).toBe("failed");
  expect(host.createObjectURL).not.toHaveBeenCalled();
});
it("synchronous screen disposal during click creates no remaining timer", () => {
  vi.useFakeTimers();
  const { host, anchor } = fakeHost();
  const h = createDownloadHandle(new Blob(["x"]), "x.md", host);
  anchor.click = vi.fn(() => h.dispose());
  expect(h.request()).toEqual({ status: "requested" });
  expect(h.state).toBe("disposed");
  expect(vi.getTimerCount()).toBe(0);
  expect(host.revokeObjectURL).toHaveBeenCalledTimes(1);
});
