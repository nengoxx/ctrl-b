// The gacha theme's FROZEN Japanese copy (D52 / GACHA_PLAN R8 + Q8.6b) — the single source for every
// compile-time JP string the theme renders, and therefore the single source for the glyph set the committed
// font subsets must cover (§10.4).
//
// WHY ONE MODULE: the theme ships a build-time SUBSET of Zen Kaku Gothic New / Shippori Mincho B1 frozen to
// exactly these glyphs (the naive @fontsource JP path measured 757 KB over ~72 requests — rejected). A glyph
// that isn't here isn't in the font. `scripts/gen-theme-fonts.mjs` derives the subset from `gachaGlyphSet()`
// below, and `tests/themes/gachaFonts.test.ts` re-derives it and fails if the committed manifest has drifted
// — that guard is what keeps "frozen" changeable: edit a string here, re-run the script, commit the outputs.
//
// DEGRADATION CONTRACT (council L12): this covers COMPILE-TIME copy only. Any RUNTIME Japanese — a host
// name, a roster entry name, a chat message — falls back to the system JP stack in `--font-body`'s tail, BY
// DESIGN. That is not a bug to fix by shipping the full font.
//
// The owner's constraint (Q8.6b): real Japanese, kanji where it is the natural writing, kana otherwise —
// never decorative pseudo-JP. Each string's reading + gloss is noted so a future edit can keep that bar.

export const GACHA_COPY = {
  // ── Brand (§4.3 — the ruled katakana wordmark; the exact rendering is a G1 eyeball pick between the two,
  //    so BOTH are frozen into the subset now and switching costs no font regeneration) ──
  /** "Capsule Arcade" — the prototype's own brand, in katakana. */
  brandWordmark: "カプセルアーケード",
  /** "control-b" — the app's own name transliterated; the alternative reading (§4.3). */
  brandWordmarkAlt: "コントロール・ビー",
  /** ネットワーク景品所 (nettowāku keihinjo) — "network prize parlour"; the appbar subtitle. */
  brandMeta: "ネットワーク景品所",

  // ── Nav sub-labels (Q8.6b — all four verified as genuine words; the 4-tab layout fence needs Utils too) ──
  /** 編成 (hensei) — "formation". */
  tabFleet: "編成",
  /** 案内 (annai) — "guidance". */
  tabAgent: "案内",
  /** ツール (tsūru) — the standard katakana loanword for "tools". */
  tabUtils: "ツール",
  /** 設定 (settei) — "settings". */
  tabConf: "設定",

  // ── Fleet: banner + track (G1) ──
  /** 開催中 (kaisai-chū) — "now running"; the fixed hero's tag, with its Latin PICKUP. */
  heroTag: "開催中",
  /** The fixed hero's frozen caption — flavour, no data dependency. */
  heroCaption: "残り 3日",
  /** 天井 (tenjō) — the gacha "pity ceiling"; frozen flavour beside the rate pill. */
  pityLabel: "天井",
  /** 排出率 (haishutsu-ritsu) — "drop rate"; the JP reading of the ★N RATE pill. */
  rateLabel: "排出率",
  /** 確率アップ (kakuritsu appu) — "rate up"; an ONLINE host's promo tag. */
  promoTagOnline: "確率アップ",
  /** 限定イベント (gentei ibento) — "limited event"; a SLEEPING host's promo tag. */
  promoTagSleeping: "限定イベント",
  /** 稼働中 (kadō-chū) — "in operation". */
  promoCaptionOnline: "稼働中",
  /** 休眠中 (kyūmin-chū) — "dormant". */
  promoCaptionSleeping: "休眠中",
  /** 待機中 (taiki-chū) — "standing by"; the sleeping card's plate. */
  cardSleeping: "待機中",
  /** The track heading (編成 again — kept as its own key so the heading can move independently). */
  trackHead: "編成",

  // ── Agent: the oracle (G3) ──
  /** ラッキーリレー (rakkī rirē) — "Lucky Relay"; the operator's name. */
  oracleName: "ラッキーリレー",
  /** コマンド入力 (komando nyūryoku) — "command input"; the composer placeholder (… included). */
  composerPlaceholder: "コマンド入力…",

  // ── Dossier metric labels (§4.8 — the ruled frontier grid, G2) ──
  /** 応答 (ōtō) — "response" (Ping). */
  metricPing: "応答",
  /** 稼働 (kadō) — "operation" (Uptime). */
  metricUptime: "稼働",
  /** サービス (sābisu) — "services". */
  metricServices: "サービス",
  /** 最終確認 (saishū kakunin) — "last confirmed" (Seen). */
  metricSeen: "最終確認",

  // ── The `ThemeDef.settings` descriptors (Codex G0 #1) ────────────────────────────────────────────
  // These are PRODUCTION strings the Conf Appearance rows render, so they belong here for exactly the
  // same reason the rest does: whatever is not in this file is not in the shipped font. ★ (U+2605) is
  // the sharp case — it is not in any Latin subset, so before this move the seg read "5★" in a fallback
  // face. The bilingual descriptions follow the prototype's own row copy (an English gloss · the JP word)
  // and carry `·` (U+00B7), which the Latin subset does cover but which this file must still own so the
  // no-non-ASCII-outside-copy guard can be absolute rather than a list of exceptions.
  /** The 5★ rarity-scale seg option. */
  starModeFive: "5★",
  /** The 3★ rarity-scale seg option. */
  starModeThree: "3★",
  /** 星 (hoshi) — "star". */
  settingStarsDesc: "rarity scale · 星",
  /** 壁紙 (kabegami) — "wallpaper". */
  settingWallpaperDesc: "pickup art fills the fleet background · 壁紙",
  /** 定着 (teichaku) — "fixing in place"; the sticky operator art. */
  settingOracleDesc: "the header fades in place instead of scrolling away · 定着",
} as const;

export type GachaCopyKey = keyof typeof GACHA_COPY;

/** The theme's frozen glyph set: every NON-ASCII character used by `GACHA_COPY`, sorted by code point.
 *  Pure + dependency-free so both the generator script and the guard test derive the SAME list from the
 *  SAME source. ASCII is excluded on purpose — the Latin/digit/punctuation coverage comes from the fonts'
 *  full `latin` subsets, not from this frozen list. */
export function gachaGlyphSet(): string[] {
  const out = new Set<string>();
  for (const s of Object.values(GACHA_COPY)) {
    for (const ch of s) if (ch.codePointAt(0)! > 0x7f) out.add(ch);
  }
  return [...out].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}
