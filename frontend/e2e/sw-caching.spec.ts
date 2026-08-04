import { test, expect } from "./fixtures";

// The service worker's CACHING CONTRACT, asserted against the REAL generated artifact (D52/G5 B4,
// GACHA_PLAN §10.4). The preview server this suite runs against serves the same `dist/sw.js` a device
// installs, so this reads the shipped file rather than re-stating vite.config's intent back at itself.
//
// It lives in e2e for exactly that reason: a unit test could only assert the CONFIG, and the config is
// not what runs. `generateSW` compiles `runtimeCaching` into `registerRoute(...)` calls and the precache
// globs into a manifest — a mistake in either (a glob that sweeps a build report, a handler that pins an
// owner's replaced image forever) is only visible here.
//
// Fetched with `request`, not the browser: an installed SW would intercept its own file, and the page
// context is irrelevant to what we are reading.

test("the SW ships both runtimeCaching routes, with the handler each resource actually needs", async ({
  request,
}) => {
  const sw = await (await request.get("/sw.js")).text();
  // The compiled routes are REGEXP LITERALS, so every slash in them is backslash-escaped. Unescaping
  // once keeps the assertions below readable as the patterns they are.
  const flat = sw.replace(/\\\//g, "/");

  // Hashed build outputs: a changed font is a changed filename, so the cached copy can never be stale.
  expect(flat).toContain("/assets/[^/]+\\.woff2$");
  expect(flat).toMatch(/woff2\$\/,new \w+\.CacheFirst\(\{cacheName:"ctrlb-fonts"/);

  // The owner's own files, mutable under a STABLE name. CacheFirst here would pin replaced art forever,
  // against the mount's own `Cache-Control: no-cache` — this is the assertion that says so.
  expect(flat).toMatch(/,new \w+\.StaleWhileRevalidate\(\{cacheName:"ctrlb-media"/);
  expect(flat).not.toMatch(/CacheFirst\(\{cacheName:"ctrlb-media"/);
});

test("the media route matches PATHS, not anything with a media-looking href", async ({
  request,
}) => {
  // Codex F2, pinned behaviourally rather than by source-reading: the matcher is lifted OUT of the
  // shipped SW and called. A regexp `urlPattern` is tested by workbox against the full unanchored
  // href, so the previous form matched any URL that merely CONTAINED the media path — including live
  // state with it in a query string.
  const sw = await (await request.get("/sw.js")).text();
  const src = /registerRoute\((\(\{url.*?),new \w+\.StaleWhileRevalidate/.exec(sw);
  expect(src, "the media route should be a callback matcher, not a bare RegExp").not.toBeNull();
  // Compiling the extracted source is the POINT of this test — it is the only way to ask the shipped
  // matcher what it actually matches, rather than reading its source and believing ourselves. The input
  // is our own build output, fetched from our own preview server, inside a test process; the two rules
  // below exist to stop untrusted strings becoming code, which is not what is happening here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  const match = new Function(`return (${src![1]})`)() as (a: {
    url: URL;
    sameOrigin: boolean;
  }) => unknown;

  const at = (href: string, sameOrigin = true) => !!match({ url: new URL(href), sameOrigin });

  expect(at("http://h/api/media/gacha/files/characters/lyra.webp")).toBe(true);
  expect(at("http://h/api/media/gacha/files/reel/cut%20out.webp")).toBe(true);

  // THE regression: live state is never cached because its query string looks like art.
  expect(at("http://h/api/settings?next=/api/media/gacha/files/")).toBe(false);
  expect(at("http://h/api/agent/chat#/api/media/gacha/files/x.png")).toBe(false);
  // the JSON index is live state too — only the FILES mount is cacheable
  expect(at("http://h/api/media/gacha")).toBe(false);
  // and never another origin's lookalike path
  expect(at("http://evil/api/media/gacha/files/x.png", false)).toBe(false);
});

test("the precache manifest carries the app and NOTHING it never requests", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);

  expect(urls.length).toBeGreaterThan(10);
  expect(urls).toContain("index.html");
  // `dist/stats.html` is the rollup-visualizer BUILD REPORT (~290 KB). The bare `**/*.html` glob sweeps
  // it in, where it costs every install its size for a file nothing ever fetches.
  expect(urls.some((u) => u.includes("stats"))).toBe(false);
  // Fonts are RUNTIME-cached now, deliberately: precaching them would charge every install for four
  // themes' faces to make one theme work offline. Cached on first use, an unused theme costs nothing.
  expect(urls.filter((u) => u.endsWith(".woff2"))).toHaveLength(0);
});
