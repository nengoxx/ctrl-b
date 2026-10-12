import { afterEach, describe, expect, it } from "vitest";

import { captureOwned, ownCapture, resetCaptureOwners } from "../../src/store/micRelease";

// store/micRelease — the TAB's capture ownership (ISS-84 part F). Owner TOKENS, not a flag: an upload
// and a recording overlap, and each release must give back only its own claim — idempotently.

afterEach(resetCaptureOwners);

describe("micRelease · captureOwned", () => {
  it("is false with no owner, true while any owner holds it", () => {
    expect(captureOwned()).toBe(false);
    const release = ownCapture();
    expect(captureOwned()).toBe(true);
    release();
    expect(captureOwned()).toBe(false);
  });

  it("overlapping owners: one releasing never clears the other", () => {
    const upload = ownCapture();
    const recording = ownCapture();
    upload();
    expect(captureOwned()).toBe(true); // the recording still owns the tab
    recording();
    expect(captureOwned()).toBe(false);
  });

  it("a release is idempotent — a belt call cannot steal another owner's claim", () => {
    const a = ownCapture();
    const b = ownCapture();
    a();
    a(); // a counter would have dropped b's count here
    expect(captureOwned()).toBe(true);
    b();
    expect(captureOwned()).toBe(false);
  });
});
