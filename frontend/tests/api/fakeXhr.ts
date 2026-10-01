import { vi } from "vitest";

// A stand-in `XMLHttpRequest` for the raw-body write path (`putBytes` sends over XHR — its doc comment
// says why). Records every request and answers through `respond`, a mock a test can re-aim per arm:
// `{ status, json }` for a JSON body, `{ status, text, statusText }` for anything else, or
// `"network-error"` for a request that never reached a server. Shared by every test whose code under
// test uploads, so there is one fake rather than one per suite (the `dictationFakes` precedent).

export interface XhrCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type XhrAnswer =
  { status: number; json?: unknown; text?: string; statusText?: string } | "network-error";

export function installFakeXhr(answer: XhrAnswer = { status: 200, json: {} }) {
  const calls: XhrCall[] = [];
  const respond = vi.fn((_call: XhrCall): XhrAnswer => answer);
  class FakeXhr {
    status = 0;
    statusText = "";
    responseText = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private call: XhrCall = { method: "", url: "", headers: {}, body: undefined };
    open(method: string, url: string) {
      this.call = { method, url, headers: {}, body: undefined };
    }
    setRequestHeader(name: string, value: string) {
      this.call.headers[name] = value;
    }
    send(body: unknown) {
      this.call.body = body;
      calls.push(this.call);
      const a = respond(this.call);
      queueMicrotask(() => {
        if (a === "network-error") return this.onerror?.();
        this.status = a.status;
        this.statusText = a.statusText ?? "";
        this.responseText = a.json !== undefined ? JSON.stringify(a.json) : (a.text ?? "");
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return { calls, respond };
}
