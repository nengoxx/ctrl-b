import { vi } from "vitest";

// Global test setup (vitest `setupFiles`). Only the unavoidable browser-API shims jsdom lacks live
// here; richer fakes (Audio, MediaRecorder, fetch) are built per-test so each case stays explicit and
// isolated. Runs in the jsdom env before every test file.

// jsdom doesn't implement Object URLs — the audio controller's per-message blob cache needs them.
URL.createObjectURL = vi.fn(() => "blob:mock-url");
URL.revokeObjectURL = vi.fn();
