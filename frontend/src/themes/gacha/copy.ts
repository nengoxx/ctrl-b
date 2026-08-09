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
  // ── Brand (§4.3 — the ruled katakana wordmark. BOTH readings are frozen into the subset, which is what
  //    made the G6 swap below a value edit with no font regeneration: the glyph set is derived from this
  //    whole object, so moving which key is SHIPPED changes nothing about the committed woff2s) ──
  /** The SHIPPED wordmark: "control-b" transliterated — コントロール・ビー. Re-ruled 2026-08-06 by the
   *  owner from live side-by-side renders of both readings ("the one with the dot in the middle — it looks
   *  better"); it replaced カプセルアーケード, which stands below as the alternative. */
  brandWordmark: "コントロール・ビー",
  /** "Capsule Arcade" — the prototype's own brand, in katakana; the alternative reading (§4.3). */
  brandWordmarkAlt: "カプセルアーケード",
  /** ネットワーク景品所 (nettowāku keihinjo) — "network prize parlour". The app bar's SUBTITLE, and since
   *  the refined G6.3 ruling (owner 2026-08-06) it is TOGGLE-GATED rather than retired: GachaRoot passes it
   *  as `brandMeta` on every render, and the kit shows it only while the synced "Bar subtitle" Appearance
   *  switch is on (it ships OFF — icon + title only is the resting bar). */
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

  // ── Shared glyphs (G1) ──────────────────────────────────────────────────────────────────────────
  // Not words — single characters the Fleet composes strings from at runtime (a star ladder, a plate's
  // separator). They live HERE because of the absolute non-ASCII fence (`gachaChrome.test.ts`): outside
  // this module the theme's TypeScript contains no non-ASCII at all, so a glyph a component needs has to
  // be a copy constant even when it carries no language. Neither ADDS to the frozen subset — ★ already
  // rides `starModeFive` and · already rides `settingStarsDesc`, and `gachaGlyphSet()` is a SET, so the
  // committed font manifest is untouched by these two keys.
  /** ★ (U+2605) — one rarity star; the cards and the rate pill repeat it (§6.2/§6.3). */
  star: "★",
  /** · (U+00B7) — the prototype's separator inside a capsule plate (`ROLE · 18 ms`). */
  sep: "·",

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
  /** 限定イベント (gentei ibento) — "limited event"; a banner SCENE slide's tag. Deliberately its own key
   *  rather than a reference to `promoTagSleeping`, which happens to read the same today: they are
   *  different surfaces with different reasons, and a future edit to one must not silently move the other.
   *  Its glyphs already ride the frozen subset through that key, so the font manifest is untouched. */
  sceneTag: "限定イベント",
  /** 開催中 (kaisai-chū) — "now running"; a banner SCENE slide's caption. Same relationship to `heroTag`:
   *  same value today, separate semantic home, no new glyphs. */
  sceneCaption: "開催中",
  /** The track heading (編成 again — kept as its own key so the heading can move independently). */
  trackHead: "編成",

  // ── Fleet: the COVER layout's static fiction (E2 / §12.6 ruling 9) ──────────────────────────────
  // A magazine cover is mostly PRINT, and none of this print is data: the masthead, the featured-unit
  // eyebrow, the change-cover hint, the registry fine print and the price are the composition's own
  // furniture. They live here for the same reason every other string does — whatever is not in this file
  // is not in the shipped font — and each LINE is its own key rather than one string with `\n`, because
  // the markup breaks them with `<br>` and a split helper would be a second place for them to live.
  //
  // 特集 (tokushū) — "special feature"; the eyebrow over the hero's name. The ONE pair of new glyphs this
  // slice adds (the E1 workflow, verbatim: edit here → `npm run fonts:gacha` → commit the subsets). ¥ is
  // the third new character and is not a kanji at all — U+00A5 already rides every LATIN subset's
  // `U+0000-00FF` range, so it paints in-face today; it joins the frozen set only because
  // `gachaGlyphSet()` collects every non-ASCII value in this object, which is the fence working, not a
  // cost worth avoiding.
  /** The masthead's kicker — the app's own wordmark, in the cover's small caps. */
  coverKicker: "CTRL/B",
  /** The masthead display line, first row. */
  coverTitle1: "FLEET",
  /** …and its second row. */
  coverTitle2: "STORY",
  /** The eyebrow over the hero's name — "FEATURED UNIT" with its Japanese reading. */
  coverFeatured: "FEATURED UNIT · 特集",
  /** The ISSUE line's leading word; `fleet.ts#issueLine` composes the number and the status onto it. */
  coverIssue: "ISSUE",
  /** The cut-in column's standing hint, first line. */
  coverHint1: "CHANGE COVER",
  /** …and its second line. */
  coverHint2: "TAP A CUT-IN",
  /** The footer's registry fine print, first line. */
  coverFine1: "CTRL/B FLEET STORY · SERIES 2026",
  /** …and its second line. */
  coverFine2: "PRINTED ON THE TAILNET · NOT FOR RESALE",
  /** The cover price gag. ¥ (U+00A5) — see the block note: latin-subset coverage, frozen-set membership. */
  coverPrice: "¥0",
  /** The develop ceremony's landed stamp. Decoration with a 320 ms life, `aria-hidden` in the markup: the
   *  machine's real state is the chip beside it, which says the SERVER's word (§12.6 ruling 4). */
  coverStamp: "AWAKE",

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
  /** The dossier's held/deferred metric value — the RULED em dash (§4.8's literal), not the ASCII hyphen
   *  the G1 rate pill uses while loading. It lives here because gacha TS outside this file is
   *  ASCII-fenced; the latin faces carry U+2014 in their `U+2000-206F` range, and joining this set puts
   *  it in the JP subsets too, so it renders in-face in every family. */
  metricPending: "—",

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
  /** 紙 (kami) — "paper"; the unit dossier's own surface (G6's dossier palette picker). Chosen from words
   *  whose glyphs the frozen subset ALREADY carries (紙 rides `settingWallpaperDesc`'s 壁紙), so the picker
   *  ships bilingual like its siblings at zero font cost — and it is the right word anyway: the dossier is
   *  an arcade prize SLIP. */
  settingDossierDesc: "the unit dossier's own surface · 紙",
  /** 名 (na/mei) — "name"; the face the machine NAME is set in (the R17 rider's picker, 2026-08-06). The
   *  ONE glyph in this module that did not already ride the frozen subset — every other candidate word
   *  (書体 · 文字 · 名前) needed two or more, and none of their kanji were present either. Adding it is the
   *  documented workflow, not a workaround: edit here → `npm run fonts:gacha` → commit. It re-subsets the
   *  six JP files (+~200 B total) and leaves all eight LATIN files byte-identical, which is the property
   *  worth checking after any re-run. */
  settingNameFontDesc: "the display face for machine names · 名",
  /** The SECOND name-face row (the per-surface split, owner 2026-08-07) — same 名 as its sibling above, so
   *  this string adds NOTHING to the frozen subset: `gachaGlyphSet()` is a set over every value in this
   *  object, and both of its non-ASCII glyphs (· and 名) already ride `settingNameFontDesc`. That is the
   *  rule for any new descriptor, not a happy accident — reach for a word the subset already carries, and
   *  the copy edit stays a copy edit instead of a font regeneration. The wording names the SURFACE
   *  (capsule cards) because that is the only thing distinguishing this row from the one above it. */
  settingCardNameFontDesc: "the display face on the capsule cards · 名",
  /** 編成 (hensei) — "formation"; the FLEET LAYOUT picker (§12.6 E1). The same word the Fleet tab's own
   *  sub-label and track heading carry, which is the point: this row picks how that formation is drawn.
   *  Both of its non-ASCII glyphs already ride the frozen subset (編 + 成 via `tabFleet`/`trackHead`, ·
   *  via every descriptor above), so declaring it costs the font manifest nothing — the rule for a new
   *  descriptor, not a happy accident.
   *
   *  It gained its middle clause at E2 (main-seat ruling, §12.3⑤ house style): the cover is a FIXED
   *  full-viewport composition, so it is the one layout whose look genuinely depends on another switch —
   *  the app bar eats the top of its masthead. Saying so in the desc is cheaper and more honest than a
   *  second conditional row, and it rides existing glyphs only. */
  settingFleetLayoutDesc:
    "how the fleet presents its machines · cover pairs best with the app bar hidden · 編成",
  /** 名 (na/mei) — "name"; the POSTER NAME picker, which is layout-scoped (`showWhen`) to the poster and
   *  chooses only WHERE the machine name sits on a slice. Same 名 as the two face pickers above — a third
   *  rider on a glyph the subset already carries. */
  settingPosterNameDesc: "the name's seat on each poster slice · 名",
  /** 開催 (kaisai) — "an event being held"; the PICKUP BANNER's form (§12.6 E3). It is the BANNER'S OWN
   *  WORD — `heroTag` prints 開催中 on the hero slide this row governs — so the descriptor names the thing
   *  in the same voice the thing uses, and both glyphs already ride the frozen subset through that tag.
   *  Zero new glyphs, no font re-run: the standing rule for a new descriptor (see
   *  `settingCardNameFontDesc`), not a happy accident.
   *
   *  It names the ROOM rather than a switch, because the row is a three-value seg and "off" is only one of
   *  them: `on` is the 232 px hero band, `minimal` the 88 px strip, `off` nothing at all. */
  settingBannerDesc: "how much room the pickup banner takes above the fleet · 開催",

  /** THE UNIT TAG POOL (owner, third dev-unit walk: "in the upper right corner there was a small icon —
   *  I would like something like that"). Eight single kanji, drawn by POSITION, for the poster slice's
   *  vertical corner tag.
   *
   *  FLAVOUR, NEVER DATA. §12.6 ruling 8 dropped the lab's per-HOST JP (天馬 for pegasus, 地図 for atlas…)
   *  as mock-roster fiction — a real hostname has no Japanese reading, and inventing one per machine is
   *  the thing that was wrong with it. This revives the LOOK on the `SCENE_TITLES` pattern instead: a
   *  frozen pool assigned deterministically by fleet position, carrying no claim about the machine at
   *  all. `aria-hidden` in the markup for the same reason.
   *
   *  SINGLE kanji, deliberately: the lab's tags are two glyphs and the tag is set VERTICALLY, so a
   *  two-glyph tag is twice as tall in a corner the shear is already eating into. One glyph keeps it
   *  small enough to clear the diagonal at every column width.
   *
   *  ONE STRING rather than an array, because `gachaGlyphSet()` walks this object's values AS STRINGS —
   *  an array here would corrupt the derivation the frozen subset is generated from (the reason
   *  `SCENE_TITLES` lives outside this object). `unitTags()` splits it, so there is still one source.
   *  Read: 天 heaven · 地 earth · 星 star · 月 moon · 風 wind · 雷 thunder · 海 sea · 火 fire — the
   *  elemental register a gacha roster names its units in, and eight NEW glyphs to the frozen subset. */
  unitTagGlyphs: "天地星月風雷海火",
} as const;

export type GachaCopyKey = keyof typeof GACHA_COPY;

/** The banner SCENE slides' title pool (G1 eyeball round 3, owner-ruled) — what a dropped banner image is
 *  called. Researched against how real gacha banners name themselves: Genshin's "Epitome Invocation" /
 *  "Sparkling Steps", HSR's "Light Cone Event Warp", Arknights' "Headhunting" — a poetic-plus-system
 *  two-word register — crossed with this app's own network identity, which is where UPLINK / RELAY /
 *  CIRCUIT / PACKET / UPTIME come from.
 *
 *  Scene i takes `SCENE_TITLES[i % length]`, so ANY number of dropped images is titled, deterministically,
 *  with no per-file authoring and never a bare number.
 *
 *  BESIDE `GACHA_COPY`, not inside it: `gachaGlyphSet()` walks that object's values as STRINGS, and an
 *  array value would corrupt the glyph derivation the frozen font subset is generated from. It lives in
 *  this module anyway because production copy has ONE home here — the font fence is the reason the module
 *  exists, not the only thing it is for. All-ASCII by design, so the subset is untouched either way. */
export const SCENE_TITLES = [
  "CAPSULE FESTIVAL",
  "MIDNIGHT UPLINK",
  "STARLIGHT RELAY",
  "LUCKY CIRCUIT",
  "NEON HEADHUNT",
  "PACKET CARNIVAL",
  "AURORA PROTOCOL",
  "GOLDEN UPTIME",
] as const;

/** The unit-tag pool as a LIST, split from its one frozen string (see `unitTagGlyphs`). Derived rather
 *  than declared twice, so the pool and the subset can never disagree about what ships. */
export function unitTags(): string[] {
  return [...GACHA_COPY.unitTagGlyphs];
}

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
