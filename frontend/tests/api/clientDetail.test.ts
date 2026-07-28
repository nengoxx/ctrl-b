import { describe, expect, it } from "vitest";

import { formatDetail } from "../../src/api/client";

/** A11 pre-release audit, HIGH. `JSON.stringify(detail)` printed the whole rejected document into a
 *  toast, including a real `api_key`. The renderer is a WHITELIST: anything it does not recognise must
 *  degrade to nothing, so an unexpected body shape can never echo a value. */
describe("formatDetail", () => {
  it("renders the strict-resolve envelope as path: message", () => {
    expect(
      formatDetail([{ path: "voice.stt.provider", message: "unknown provider 'ghost'" }]),
    ).toBe("voice.stt.provider: unknown provider 'ghost'");
  });

  it("renders a pydantic error from loc + msg, joining several with a separator", () => {
    expect(
      formatDetail([
        { loc: ["providers", "p", "base_url"], msg: "Field required", type: "missing" },
        { loc: ["server", "port"], msg: "Input should be a valid integer", type: "int_parsing" },
      ]),
    ).toBe("providers.p.base_url: Field required · server.port: Input should be a valid integer");
  });

  it("NEVER echoes a rejected value, even if a body carries one", () => {
    const out = formatDetail([
      {
        loc: ["providers"],
        msg: "Input should be a valid dictionary",
        type: "dict_type",
        input: { p: { api_key: "sk-CANARY", base_url: "http://x/v1" } },
        ctx: { note: "sk-CANARY" },
        url: "https://errors.pydantic.dev/2.13/v/dict_type",
      },
    ]);
    expect(out).toBe("providers: Input should be a valid dictionary");
    expect(out).not.toContain("CANARY");
  });

  it("returns null for shapes it cannot render, so the caller keeps the status line", () => {
    expect(formatDetail(undefined)).toBeNull();
    expect(formatDetail({ unexpected: "object", api_key: "sk-CANARY" })).toBeNull();
    expect(formatDetail([{ input: { api_key: "sk-CANARY" } }])).toBeNull(); // no msg → nothing to say
    expect(formatDetail([])).toBeNull();
    expect(formatDetail("  ")).toBeNull();
  });

  it("passes a plain string detail through (the 409 shape)", () => {
    expect(formatDetail("providers changed elsewhere — refresh and re-apply")).toBe(
      "providers changed elsewhere — refresh and re-apply",
    );
  });
});
