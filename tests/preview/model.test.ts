import { describe, expect, it } from "vitest";
import { validateModel, type PreviewModel } from "../../web/preview/model.js";
import {
  PREVIEW_CONTRACT,
  PREVIEW_LIMITS,
} from "../../web/preview/protocol.js";

const model = (over: Partial<Record<keyof PreviewModel, unknown>> = {}) => ({
  contract: PREVIEW_CONTRACT,
  frontmatter: null,
  body: [{ k: "p", c: [{ k: "text", v: "本文" }] }],
  notices: [],
  ...over,
});
const invalid = { ok: false, kind: "invalid" };
const para = (...c: unknown[]) => model({ body: [{ k: "p", c }] });

describe("S8-01 main-thread model validation", () => {
  it("accepts the exact shape and counts nodes/text", () => {
    expect(validateModel(model())).toEqual({
      ok: true,
      model: model(),
      nodes: 2,
      text: 2,
    });
    expect(
      validateModel(
        model({
          frontmatter: { status: "valid", fields: [["title", "題"]], raw: "r" },
          notices: ["image-not-loaded", "tcy-horizontal"],
        }),
      ),
    ).toMatchObject({ ok: true, nodes: 3, text: 4 });
  });
  it("rejects HTML strings, extra keys, unknown kinds and wrong contracts", () => {
    expect(validateModel("<p>html</p>")).toEqual(invalid);
    expect(validateModel(null)).toEqual(invalid);
    expect(validateModel({ ...model(), html: "<b>" })).toEqual(invalid);
    expect(validateModel(model({ contract: "aozora-preview-v0" }))).toEqual(
      invalid,
    );
    expect(validateModel(model({ body: [{ k: "script", c: [] }] }))).toEqual(
      invalid,
    );
    expect(
      validateModel(para({ k: "text", v: "x", href: "javascript:" })),
    ).toEqual(invalid);
    expect(validateModel(para({ k: "text", v: 1 }))).toEqual(invalid);
    expect(validateModel(para({ k: "br" }))).toEqual(invalid);
    expect(validateModel(para({ k: "u", c: "x" }))).toEqual(invalid);
    expect(
      validateModel(model({ body: [{ k: "h", level: 7, c: [] }] })),
    ).toEqual(invalid);
    expect(
      validateModel(model({ body: [{ k: "indent", level: 0, c: [] }] })),
    ).toEqual(invalid);
    for (const start of [-1, 1.5, 1e10, "1"])
      expect(
        validateModel(model({ body: [{ k: "ol", start, c: [] }] })),
      ).toEqual(invalid);
    expect(
      validateModel(model({ body: [{ k: "ul", c: [{ k: "p", c: [] }] }] })),
    ).toEqual(invalid);
  });
  it("rejects prototype tricks and non-plain objects", () => {
    const nullProto = Object.assign(Object.create(null), model());
    expect(validateModel(nullProto)).toEqual(invalid);
    const proto = JSON.parse(
      '{"contract":"aozora-preview-v1","frontmatter":null,"body":[],"notices":[],"__proto__":{"x":1}}',
    );
    expect(validateModel(proto)).toEqual(invalid);
    expect(
      validateModel(
        model({
          frontmatter: {
            status: "valid",
            fields: [["__proto__", "x"]],
            raw: "",
          },
        }),
      ),
    ).toEqual(invalid);
    expect(
      validateModel(model({ body: [Object.create({ k: "hr" })] })),
    ).toEqual(invalid);
    class Fake {
      k = "hr";
    }
    expect(validateModel(model({ body: [new Fake()] }))).toEqual(invalid);
    expect(
      validateModel(model({ body: Object.assign([], { extra: 1 }) })),
    ).toMatchObject({ ok: true });
  });
  it("rejects unknown or duplicated notices and bad frontmatter", () => {
    expect(validateModel(model({ notices: ["x"] }))).toEqual(invalid);
    expect(
      validateModel(model({ notices: ["tcy-horizontal", "tcy-horizontal"] })),
    ).toEqual(invalid);
    expect(
      validateModel(model({ frontmatter: { status: "valid", raw: "" } })),
    ).toEqual(invalid);
    expect(
      validateModel(
        model({ frontmatter: { status: "invalid", raw: "", fields: [] } }),
      ),
    ).toEqual(invalid);
  });
  it("enforces depth, node and text limits", () => {
    let deep: unknown = { k: "p", c: [{ k: "text", v: "x" }] };
    for (let i = 0; i < PREVIEW_LIMITS.depth; i++)
      deep = { k: "quote", c: [deep] };
    expect(validateModel(model({ body: [deep] }))).toEqual({
      ok: false,
      kind: "limit",
      reason: "depth",
    });
    let fits: unknown = { k: "hr" };
    for (let i = 1; i < PREVIEW_LIMITS.depth; i++)
      fits = { k: "quote", c: [fits] };
    expect(validateModel(model({ body: [fits] }))).toMatchObject({
      ok: true,
      nodes: PREVIEW_LIMITS.depth,
    });
    const many = Array.from({ length: PREVIEW_LIMITS.nodes + 1 }, () => ({
      k: "hr",
    }));
    expect(validateModel(model({ body: many }))).toEqual({
      ok: false,
      kind: "limit",
      reason: "nodes",
    });
    expect(
      validateModel(model({ body: many.slice(0, PREVIEW_LIMITS.nodes) })),
    ).toMatchObject({ ok: true, nodes: PREVIEW_LIMITS.nodes });
    const big = "x".repeat(PREVIEW_LIMITS.textUnits);
    expect(validateModel(para({ k: "text", v: big }))).toMatchObject({
      ok: true,
      text: PREVIEW_LIMITS.textUnits,
    });
    expect(validateModel(para({ k: "text", v: big + "y" }))).toEqual({
      ok: false,
      kind: "limit",
      reason: "text",
    });
  });
});
