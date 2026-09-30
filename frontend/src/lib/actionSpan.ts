// The single-asterisk PAIRING RULE — the one source of truth for what a `*…*` span is (session-51
// polish #2). The EYE (lib/markdown.tsx's multi-line em pre-pass) and the EAR (lib/toSpeech.ts's
// `speakActions: false` drop + its read-along cut) both read a roleplay action through these three
// regexes, so what is italicized on screen is exactly what the voice treats as an action.
//
// Spelled in lib/markdown.tsx's `em` shape (`^\*([^*\s][^*]*)\*`): an opener is a `*` followed by a
// non-space, the closer is the next single `*`. Scope is `*` ONLY — `_` pairs falsely across lines in
// snake_case prose, and `**` (bold) is its own construct.

// THE BOUNDARY GUARD every opener carries: `(?<![\w*])` — an opener is never glued to a word character
// or to another `*` (session-51 fix wave 1). Without it the inner stars of a same-line `**bold**`
// (`**CPU**: 12%\n**RAM**: 40%`) pair with each other ACROSS the line break, and an intraword `*`
// (`2*3`, `f*ck`) opens a span that swallows the rest of the reply — for the eye (italicized to the
// end once settled) and for the ear (deleted under `speakActions: false`). Both halves read these same
// regexes, so they stay identical by construction. Accepted residual: a bare `*.tmp` in prose (a `*`
// after a space) is still an opener.

/** A CLOSED single-asterisk span, in lib/markdown.tsx's `em` spelling (`^\*([^*\s][^*]*)\*`) so the
 *  EAR drops exactly what the EYE italicizes. `[^*]` matches newlines on purpose: a roleplay action
 *  routinely runs over several lines (and paragraphs), and both halves pair it as ONE span. The opener
 *  carries the boundary guard above and the closer must not be half of a `**`, so a bold's stars can
 *  neither open nor close one.
 *  Global: use it with `replace`/`matchAll` (never `.test`, whose `lastIndex` would carry over). */
export const ACTION_SPAN = /(?<![\w*])\*[^*\s][^*]*\*(?!\*)/g;

/** …and the one the model never closed (D74/S2 council ruling: an action is an action even when the
 *  close is missing — without this the `*` scrub in toSpeech would make its words speakable). Anchored
 *  to end-of-input, so it only ever fires on text nothing will extend. The opener must look like an em
 *  opener (`*` + non-space), carry the boundary guard, and not be half of a `**`, or "3 * 4", "2*3" and
 *  an unclosed bold would swallow the rest of the reply. */
export const ACTION_OPEN = /(?<![\w*])\*(?!\*)[^*\s][^*]*$/;

/** The bare em OPENER (zero-width past the `*`): a `*` followed by a non-space, behind the boundary
 *  guard, not half of a `**`. Read-along cuts at the earliest one still unclosed, so ordinary prose
 *  ("3 * 4", "2*3", a bullet, an unclosed bold) costs it nothing. */
export const ACTION_OPENER = /(?<![\w*])\*(?!\*)(?=[^*\s])/;
