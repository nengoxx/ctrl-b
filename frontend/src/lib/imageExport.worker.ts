// The EXPORT WORKER (D65 / MEDIA_MANAGER_PLAN §4) — thirty lines of plumbing, and nothing else.
//
// Every decision lives in `imageExport.ts`; this file only hands the pipeline the platform (an
// `OffscreenCanvas` factory and `createImageBitmap`) and turns a throw into a message. That split is
// what makes the export testable at all: a worker cannot be unit-tested, a pure `runExport(env, job)`
// can, and there is no third place for a rule to hide.
//
// It runs OFF the main thread because R54 measured the main-thread pipeline dropping ~4 frames at
// 60 Hz on a DESKTOP Gecko run (max frame gap 66 ms), and the owner's phone is 4–8× slower on this
// kind of work. `File`/`Blob` are structured-cloneable, so the whole job crosses in one post.
//
// Vite compiles this through the `new URL("./imageExport.worker.ts", import.meta.url)` reference in
// `imageExport.ts#exportImage` — a real build output with its own hashed name, not an inline blob.

import {
  ExportError,
  platformEnv,
  runExport,
  type ExportJob,
  type WorkerReply,
} from "./imageExport";

/** The worker global, minimally. A local interface rather than `DedicatedWorkerGlobalScope`: this
 *  file is typechecked with the app's DOM lib, where `self` is a Window, and pulling the webworker lib
 *  into one module of a DOM project is a fight with duplicate globals for no benefit at all. */
interface WorkerScope {
  onmessage: ((event: { data: ExportJob }) => void) | null;
  postMessage(message: WorkerReply): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  void (async () => {
    try {
      scope.postMessage({ ok: true, result: await runExport(platformEnv, event.data) });
    } catch (error) {
      // The worker's own `onerror` carries nothing worth showing anyone, so every failure comes back
      // as a MESSAGE with the sentence the pipeline wrote. An unexpected throw (a platform error, an
      // out-of-range canvas on Gecko) gets the generic line rather than a raw stack.
      scope.postMessage({
        ok: false,
        error:
          error instanceof ExportError
            ? error.message
            : "the image could not be processed on this device.",
      });
    }
  })();
};
