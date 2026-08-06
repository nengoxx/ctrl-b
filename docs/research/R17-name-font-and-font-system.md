# R17 — The PC-name display face · and the owner-droppable font system

| | |
|---|---|
| **Date** | 2026-08-06 |
| **Pass** | Two bounded halves. **(A)** Specimen/measurement pass — every candidate's licence read from `google/fonts` primary files, every size a **real byte count** downloaded in this pass (not an estimate). **(B)** Desk research — precedent apps that accept user-supplied font FILES, plus the web-platform mechanics (MDN/W3C/IANA/SIL primary sources) and a code-verified read of our own media seam. **No device round.** |
| **Question** | (A) What display face should set the gacha dossier's PC name — OFL-or-equivalent, self-hostable, small subsetted, holding a per-palette tint over a dark gradient sheet + a faint watermark? (B) How does the field let a user *drop font files in* to restyle a UI, and what would `media/kit/fonts/` need to be the same pattern as `media/kit/brand/`? |
| **Reference class** | **(A)** is a typography/licence question — the sources are the type files themselves (`google/fonts` `METADATA.pb` + `OFL.txt`), the Google Fonts CSS2 API, and the SIL OFL FAQ. **(B)** is split: the *user-supplied-font* half has real peers (Obsidian + its `custom-font` plugin, Penpot, VS Code, fontconfig/KDE) — none in the README's agent-chat peer class, which does not do theming at this depth (recorded as a negative finding, §6.0); the *mechanics* half is a **web-platform engine question** like R15, so the sources are MDN, the CSS Fonts spec, the W3C WOFF2 spec, IANA and the OpenType Sanitizer. |
| **Drove** | **the PC-name font + font-system design session (open)** — gacha v1.5.0 arc |
| **Our code under discussion** | `frontend/src/themes/gacha/gacha.css:1835–1852` (the dossier `h2`) · `frontend/src/themes/gacha/tokens.css:70–80, 478–481` · `frontend/src/themes/gacha/fonts.ts` + `fonts/faces.css` + `frontend/scripts/gen-theme-fonts.mjs` · `backend/app/core/media.py` (`MEDIA_NAMESPACES`, `ALLOWED_TYPES`, `probe_image`, `describe_file`, `list_role`) · `backend/app/api/media.py:105–128` (the mount's shape + type gates) · `frontend/src/lib/media.ts` (`revUrl`, `artIdentity`) · `frontend/src/theme-engine/kit/ownerArt.ts` · `frontend/vite.config.ts:90–121` (the SW font + media routes) |
| **Companion artefact** | `design/prototypes/gacha/research-sheets/font-specimens.html` — the rendered sheet, real palette tints, real sizes in the captions. Open it on the phone. |

**Confidence key** — **VERIFIED** = I read the primary source or ran the measurement myself in this
pass · **REPORTED** = a secondary source says so · **UNVERIFIED** = derived/expected, not checked.

---

## 0. TL;DR (the five things that change a decision)

1. **VERIFIED — the face we ship has no italic, and the dossier name is a synthetic shear.**
   `Shippori Mincho B1` publishes **`style: "normal"` only** (weights 400–800; `google/fonts`
   `ofl/shipporiminchob1/METADATA.pb`), the generated `fonts/faces.css` declares
   `font-style: normal` in **all twelve** `@font-face` blocks (zero `italic`), and `gacha.css:1843`
   asks for `font-style: italic`. Per MDN, `font-synthesis` defaults to
   `weight style small-caps position`, and with `style` enabled the browser "synthesizes an italic
   variant by artificially skewing the regular font". So the shipped PC name is a **mechanically
   sheared Japanese mincho** — and MDN's own guidance singles CJK out as the case where synthesis
   "might impede legibility". The Google Fonts CSS2 API refuses `Shippori+Mincho+B1:ital,wght@1,800`
   with **HTTP 400** (VERIFIED, probed) — there is no italic to ask for.
   *This is the finding that makes the whole question worth a session:* the "display serif, italic"
   direction is currently being faked, and the cheapest possible fix is a face that actually has one.
2. **VERIFIED — the measurement harness reproduces what is on disk byte-for-byte, so every number
   below is a shipping number.** Fetching the CSS2 API's `/* latin */` block for
   `Shippori Mincho B1:wght@800` yields **32,288 B** — exactly `src/themes/gacha/fonts/shippori-mincho-b1-800-latin.woff2`;
   `Zen Kaku Gothic New:wght@900` yields **9,564 B** — exactly the committed 900-latin file. Two
   independent cross-checks, same method `scripts/gen-theme-fonts.mjs` uses.
3. **VERIFIED — the budget is not the constraint anyone expects.** *Every* candidate's full-latin
   woff2 is **smaller than the incumbent's 31.5 KB**, most by half; the field spans **6.3 KB
   (Orbitron 900) to 24.0 KB (DM Serif Display italic)**. Swapping the dossier face is a
   **net byte SAVING** if the new face replaces `--font-display` outright, and costs at most ~+24 KB
   if it is added beside it. Size does not discriminate here — **legibility on the phone does**, which
   is what the specimen sheet is for.
4. **VERIFIED — a licence trap with exactly two names in it.** Subsetting is *modification* under the
   OFL (FAQ 2.6: *"Removing any parts of the font when delivering a webfont to a browser, including
   unused glyphs and smart font code, is considered modification"*), and a Modified Version may not
   carry a **Reserved Font Name**. We subset. Of the 30 faces measured, **only Playfair Display and
   Orbitron declare an RFN on their own name** (`OFL.txt` line 1, VERIFIED per file) — everything
   else is free of the question. Adopting either means either shipping the font unsubsetted or
   renaming it. **Non-RFN faces make this disappear**, which is a real tiebreak.
5. **VERIFIED — the font system is a *smaller* delta than the brand-icon slot was, with one genuinely
   new problem.** A `fonts` role reuses the whole `media/kit/` machine (registry row → ensure-dir →
   mount → index → `revision` → `?rev=` → SW route) with **no wire-shape change**; the FE binds by
   filename stem exactly like `frontier/stack`. The new problem is that **`ALLOWED_TYPES` is a
   single global dict** read by the mount gate *and* the listing filter — adding `.woff2` there makes
   woff2 servable in **every role of every namespace**, including `characters/`. The fix is the
   directive's own shape: promote the role from a bare string to a per-role object with an optional
   `types` field. And **the server can never learn a dropped font's real family name** (§5.4) — so the
   filename stem must be the binding, which is what the kit already does anyway.

---

# HALF A — the name face

## 1. What ships today, read from the code

**VERIFIED** (`frontend/src/themes/gacha/gacha.css:1835–1852`) — the dossier unit name:

```css
.gc-dossier-title h2 {
  font-family: var(--font-display);
  font-size: 27px;
  line-height: 1;
  font-weight: 900;
  font-style: italic;
  color: var(--gc-dossier-name);
  overflow-wrap: anywhere;
}
```

**VERIFIED** (`tokens.css:74`) — `--font-display: "Shippori Mincho B1", "Hiragino Mincho ProN", serif;`
and (`tokens.css:478–481`) `--gc-dossier-name` is derived from the sheet ink on the light `slip`
palette and stated as a palette-tinted literal on each of the six darks
(`#c5c7f7` neon · `#fefaf8` sunset · `#f8e2e5` rose · `#dcc6ee` aurora · `#72e4ee` teal ·
`#acf0d6` forest).

Three facts that constrain a replacement, all VERIFIED from the code:

- **`--font-display` is not the dossier's private face.** It is also the app-bar JP subtitle
  (`gacha.css:73`), the nav sub-label (`:452`), the fleet track head `h1` and the oracle name `h1`
  (`:1109`, `:2477`) — and, kit-wide, the tab glyph (`kit/kit.css:490`, `var(--font-display, inherit)`).
  A new *name* face is therefore either (a) a replacement of `--font-display` everywhere in gacha, or
  (b) a **new theme-private token** (`--gc-dossier-name-font`) consumed by one rule. (b) costs one
  extra face's bytes; (a) costs none but changes five surfaces the owner already signed off.
- **The requested weight does not exist either.** `faces.css` declares Shippori at 600 and 800 only;
  `font-weight: 900` matches 800 by the CSS font-matching algorithm. Harmless (no synthetic bolding),
  but it means the "900 italic" in the CSS is, in reality, **800 upright + a shear**.
- **The frozen-subset contract is Latin-safe.** `gen-theme-fonts.mjs` ships each face's **full latin
  subset** beside the frozen JP one precisely because host names are runtime text (§10.4's
  degradation contract). Any replacement inherits that: the number that matters is the **full latin**
  subset, not a name-charset subset — unless the design session decides to constrain machine names.

## 2. Method — how the sizes were measured (reproducible)

**VERIFIED.** For each family+weight+style:

1. `GET https://fonts.googleapis.com/css2?family=<Family>:<axes>&display=swap` with a desktop-Chrome
   User-Agent (the UA is what makes the API answer in woff2 — the same trick `gen-theme-fonts.mjs`
   documents).
2. Take the `/* latin */` `@font-face` block, download its `fonts.gstatic.com` woff2, count bytes →
   **"latin"** below. *This is the file that would be committed.*
3. Re-request with `&text=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.` →
   **"name-only"** below: the floor if machine names were ever constrained to that charset.

Harness cross-check (VERIFIED, §0.2): the method reproduced both committed faces exactly.
Caveat, inherited from `gen-theme-fonts.mjs`'s own honesty note: **the bytes are whatever font
version Google serves that day** — which is why the outputs are committed rather than fetched.

## 3. The measured field (2026-08-06)

Licence column: **`L`** = the `google/fonts` directory the family lives in (all 30 are `ofl/`,
VERIFIED by fetching each `METADATA.pb` — every one reports `license: "OFL"`); **`RFN`** = whether
`OFL.txt` line 1 declares a Reserved Font Name **on this family's own name**; **`ital`** = whether
`METADATA.pb` publishes a real `style: "italic"`.

### 3.1 · A — high-contrast display serifs (the current direction)

| Face (as measured) | latin woff2 | name-only | real ital | RFN | Designer (METADATA.pb) |
|---|---:|---:|---|---|---|
| **Shippori Mincho B1 800** *(incumbent)* | **32,288 B / 31.5 KB** | 14,700 B | **no** | no | FONTDASU |
| **Bodoni Moda 900 ital @opsz 96** | **16,312 B / 15.9 KB** | 9,056 B | **yes** | no | Owen Earl |
| **Playfair Display 900 ital** | **21,812 B / 21.3 KB** | 11,852 B | **yes** | **YES** | Claus Eggers Sørensen |
| Playfair Display 900 roman | 22,372 B | 11,216 B | — | **YES** | " |
| **Instrument Serif ital** (1 weight) | **22,128 B / 21.6 KB** | 13,240 B | **yes** | no | Rodrigo Fuenzalida, Jordan Egstad |
| **DM Serif Display ital** (1 weight) | **24,572 B / 24.0 KB** | 13,472 B | **yes** | no¹ | Colophon Foundry |

¹ **VERIFIED nuance:** DM Serif Display's `OFL.txt` opens
*"Copyright 2014-2018 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'. … Copyright
2019 Google LLC."* — the RFN is **`Source`**, not `DM Serif Display`. It is a Source-Serif derivative
that already used the escape hatch. Its own name is unreserved, so it subsets freely.

### 3.2 · B — slab · rounded · capsule-arcade

| Face | latin woff2 | name-only | real ital | RFN | Designer |
|---|---:|---:|---|---|---|
| **Zen Old Mincho 900** | **16,188 B / 15.8 KB** | 9,112 B | no | no | **Yoshimichi Ohira** |
| Zen Antique 400 | 16,032 B | 8,712 B | no | no | **Yoshimichi Ohira** |
| **Zen Maru Gothic 900** (rounded) | **11,564 B / 11.3 KB** | 5,116 B | no | no | **Yoshimichi Ohira** |
| Zen Dots | 13,856 B | 6,820 B | no | no | **Yoshimichi Ohira** |
| **Bungee** (arcade signage) | **14,344 B / 14.0 KB** | 5,060 B | no | no | David Jonathan Ross |
| Bungee Inline | 20,920 B | 8,016 B | no | no | David Jonathan Ross |
| Righteous | 12,756 B | 8,332 B | no | no | Astigmatic |
| Rubik Mono One | 12,752 B | 5,360 B | no | no | Hubert and Fischer |

> **The Zen argument, VERIFIED and free.** `Zen Old Mincho`, `Zen Maru Gothic`, `Zen Antique` and
> `Zen Dots` are all by **Yoshimichi Ohira** — the designer of the **`Zen Kaku Gothic New`** the theme
> already ships as `--font-body`. Picking inside that superfamily buys deliberate Latin+JP metric and
> stylistic coherence with the body face, from the same hand, at no extra argument. It also buys a
> **real 900** (Zen Old Mincho publishes 400/500/600/700/900) where the incumbent tops out at 800.
> The cost: **no italic anywhere in the Zen family**, so the italic idea is either dropped or stays
> synthetic — but at least *knowingly*.

### 3.3 · C — wildcards a gacha game would plausibly use

| Face | latin woff2 | name-only | real ital | RFN | Designer |
|---|---:|---:|---|---|---|
| **Archivo 800 ital** | **16,016 B / 15.6 KB** | 7,176 B | **yes** | no | Omnibus-Type |
| **Kanit 800 ital** (9 wts × ital) | **20,840 B / 20.4 KB** | 9,288 B | **yes** | no | Cadson Demak |
| **Orbitron 900** | **6,400 B / 6.3 KB** | 3,628 B | no | **YES** | Matt McInerney |
| **Chakra Petch 700 ital** *(already in repo — frontier)* | **10,656 B / 10.4 KB** | 4,312 B | **yes** | no | Cadson Demak |
| Tourney 800 ital (variable wght+wdth) | 14,884 B | 7,072 B | **yes** | no | Tyler Finck, ETC |
| Exo 2 900 ital | 17,596 B | 8,560 B | **yes** | no | Natanael Gama |
| Saira 800 ital | 15,180 B | 7,000 B | **yes** | no | Omnibus-Type |
| Anton | 18,612 B | 9,680 B | no | no | Vernon Adams |
| Bebas Neue | 13,768 B | 7,052 B | no | no | Ryoichi Tsunekawa (Dharma Type) |
| Oswald 700 | 12,672 B | 5,864 B | no | no | Vernon Adams, Kalapi Gajjar, Cyreal |
| Antonio 700 | 11,056 B | 4,940 B | no | no | Vernon Adams |
| Michroma | 17,908 B | 9,020 B | no | no | Vernon Adams |
| Big Shoulders Display 800 | 14,448 B | 7,280 B | no | no | Patric King |
| Unbounded 800 | 21,828 B | 8,616 B | no | no | NaN |
| Syne 800 | 13,684 B | 7,080 B | no | no | Bonjour Monde et al. |
| Bricolage Grotesque 800 @opsz 96 | 21,748 B | 9,516 B | no | no | Mathieu Triay |
| *(reference)* Zen Kaku Gothic New 900 | 9,564 B | 4,248 B | no | no | Yoshimichi Ohira |

## 4. Licences — verified per face, and the one trap

**VERIFIED, method:** for each family I fetched
`https://raw.githubusercontent.com/google/fonts/main/ofl/<slug>/METADATA.pb` (reports
`license: "OFL"`, `designer:`, `category:`, and the published `style:`/`weight:` set) **and**
`…/ofl/<slug>/OFL.txt` (the copyright line, which is where an RFN is declared). All 30 families
returned from the **`ofl/`** directory with `license: "OFL"` — none needed the `apache/` or `ufl/`
fallback. This is the primary, per-file source, not a specimen page's badge.

**The trap — subsetting vs Reserved Font Names.** SIL's own FAQ, quoted:

> **2.6** *"Yes. Removing any parts of the font when delivering a webfont to a browser, including
> unused glyphs and smart font code, is considered modification."*
> **2.2** *"A change in font format normally is considered modification, and Reserved Font Names
> (RFNs) cannot be used. Because of the design of the WOFF and WOFF2 formats, however, it is possible
> to create a WOFF/WOFF2 version that is not considered modification…"*
> **2.2.1** *"You are allowed to create, use and distribute a WOFF version of an OFL font without
> changing the font name, but only if the original font data remains unchanged except for WOFF
> compression…"*
> **2.7** *"Yes. If a webfont is optimized only in ways that preserve Functional Equivalence (see
> entry 2.8), then it may use RFNs, as it reasonably represents the Original Version."*
> **2.8** (summarised in the FAQ's own words) functional equivalence requires, among others, that the
> optimized font *"supports identical character inventory with proper display"*.

**The reading, stated so the session does not have to re-derive it:** format conversion alone is
fine; **glyph removal is not**, because identical character inventory is exactly what a subset
destroys. Our pipeline subsets (the JP half by `text=`, and even the "full latin" half is a strict
subset of a font that also carries cyrillic/vietnamese/latin-ext). Therefore a **face carrying an RFN
on its own name cannot keep that name in what we commit** under a strict reading.

- **Affected: `Playfair Display` and `Orbitron` only.** (VERIFIED per `OFL.txt` line 1 — the other 28
  declare no RFN, and DM Serif Display's reserved name is `Source`.)
- **Escape hatches, cheapest first:** ① pick a non-RFN face and the question never arises;
  ② rename the family (OFL forbids *using* the RFN, not the glyphs) — which we would want anyway for
  the font system, §6.4; ③ ship the font unsubsetted (for Playfair Display that means all four
  Google subsets, materially larger).
- **REPORTED/practice note:** Google Fonts itself serves RFN-bearing families as unicode-range
  subsets under their original names, so the strict reading is universally not enforced. **Confidence
  that this is *legally* fine: low.** It is a one-line avoidance, so avoid it.

## 5. What real gacha games set names in (and why it does not transfer)

Documented, all **REPORTED** — game typography is documented by fan wikis and fan inventories, not by
the publishers:

- **Genshin Impact** — the primary typeface is *"a proprietary typeface tweaked by miHoYo which is
  based on Hanyi WenHei (汉仪文黑) in 85W weight (Extra Bold), HYWenHei-85W"*, with the **Latin and
  Cyrillic components separate from HYWenHei-85W and likely commissioned by miHoYo**
  (Genshin Impact Wiki, *Typeface*; the page itself returned HTTP 402 to my fetcher, so this is the
  search-index summary of it — **REPORTED, second-hand**).
- **Honkai: Star Rail** — in-game dialogue in the international builds is **DIN Next** (Akira
  Kobayashi, Linotype); the English logo's lower half is a miHoYo tweak of **Nadoor Bold Italic**
  (Summit Type). **REPORTED** (Honkai: Star Rail Wiki, *Typeface*, via search index).
- **Arknights** — **VERIFIED against the fan inventory repo itself** (`TimWangZi/The-font-of-Arknights`
  README): *Bender* — 在游戏中常用于数字和UI效果表现 ("commonly used for numbers and UI effects");
  *Novecento Wide* — 在游戏中常用于表现现代感较强的英文文本 ("used for modern-feeling English text");
  plus Times New Roman / Georgia / Source Serif for formal copy. A search snippet also claims
  *Oswald* for character names — **UNVERIFIED, and the repo does not say it**; I measured Oswald
  anyway (§3.3) so the claim is cheap to judge by eye.

**The transferable conclusion, and it is a negative one:** the register that reads as "gacha" is set
by **commercial** faces (HYWenHei, DIN Next, Bender, Novecento) that we cannot bundle. Two things do
transfer:

1. **The personality lives in the display/logo face, not the UI face.** Star Rail's identity is
   carried by a **heavy italic display** (Nadoor Bold Italic) while its running text is a neutral
   grotesk. That is structurally the same move as gacha's — a neutral `--font-body` plus a loud
   `--font-display` — and it **validates the italic instinct**, which is precisely what our synthetic
   shear is currently faking.
2. **Nobody uses a high-contrast didone for a name plate.** The measured field's closest OFL
   neighbours to that register are **Archivo 800 italic** and **Kanit 800 italic** (heavy grotesk
   italics), not Bodoni/Playfair. If the goal is "reads like a gacha game", the serif direction is the
   *mock's* direction, not the genre's — worth naming out loud before the session locks it.

## 6. Shortlist — what I would put in front of the owner

Ranked, with the reason each survives, and the reason it might not.

| | Face | latin | Why it wins | Why it might lose |
|---|---|---:|---|---|
| **1** | **Bodoni Moda 900 italic @opsz 96** | **15.9 KB** | Keeps the mock's high-contrast serif direction *and* fixes the shear with a **real italic**. **Half the incumbent's bytes.** Variable `opsz` means the display cut is the one that ships. No RFN. | Didone hairlines at 27 px on a phone over a gradient + watermark are the **one real risk in this list** — this is exactly what the specimen sheet must settle, per palette. |
| **2** | **Zen Old Mincho 900** | **15.8 KB** | Same designer (**Yoshimichi Ohira**) as the shipped `Zen Kaku Gothic New` — deliberate superfamily coherence; a **real 900** where the incumbent has none; half the bytes; no RFN. The most conservative change: still a mincho, still the mock's genus. | **No italic in the whole Zen family** — either drop the italic or keep it synthetic. Least visually *new*. |
| **3** | **Archivo 800 italic** | **15.6 KB** | The **genre-honest** answer (§5): a heavy grotesk italic is what a modern gacha logotype actually is. Real italic, no RFN, half the bytes, extremely legible small. | Abandons the serif the owner signed off in the G6.3 fidelity round — a design *decision*, not a fix. |
| **4** | **Chakra Petch 700 italic** | **10.4 KB** | **Already in the repo** (frontier's `--font-display`). Real italic, no RFN, smallest of the serious candidates; a techy square grotesk that suits "capsule arcade". | Shared identity with frontier is a *cost* here: the two themes stop being visually distinct at the display role. |

**Runner-up worth a glance on the sheet:** **Playfair Display 900 italic** (21.3 KB) is the sturdiest
of the high-contrast serifs — meaningfully more robust than Bodoni at 27 px — but it is one of the
**two RFN faces** in the field, so it drags §4's licence question along.

**Not recommended despite being the smallest:** **Orbitron 900** (6.3 KB) — RFN, upright-only, and
uppercase-flavoured wide sci-fi that fights the mock's romance.

---

# HALF B — the owner-droppable font system

## 6.0 A negative finding, recorded first

**VERIFIED (search).** The README's peer class — opencode · Claude Code · Codex CLI · open-webui ·
AnythingLLM · LibreChat · Continue.dev · goose — **does not have a user-supplied-font feature to
study.** They expose theme *tokens* and CSS, not a font-file drop. The precedents below are therefore
deliberately out-of-class (Obsidian, Penpot, VS Code, fontconfig/KDE), chosen because they are the
apps that actually solved *this* problem. Per the cost-discipline note in the README, this is stated
rather than padded.

## 7. How the field does it — four precedents, four different answers

### 7.1 · Obsidian — the two-part answer (setting = a NAME; file = a snippet)

**REPORTED** (Obsidian's Appearance panel + community write-ups). Base Obsidian gives you *Interface
Font*, *Text Font*, *Monospace Font* — and each takes a **font-family name**, resolved against fonts
the **OS** has installed. To use a file you have not installed, you write a **CSS snippet** into
`<vault>/.obsidian/snippets/fonts.css` containing an `@font-face` — commonly with the font
**base64-inlined** — then enable the snippet and **type the family name into the Appearance setting**.
The reported UX tell: *"enter the custom font name exactly, and you'll see a checkmark after a
second"* — i.e. the setting is a free-text family name that is **validated by whether it resolves**.

**The lesson: two mechanisms glued by a string the user must get right.** The registration (file →
family name) and the selection (family name → role) are separate, and the string between them is the
whole failure surface. On mobile, where there is no OS font install, the base64 snippet is the *only*
path — which is why a plugin exists to remove it.

### 7.2 · `obsidian-custom-font` — **the closest precedent to what we want**

**VERIFIED** (repo README, `pourmand1376/obsidian-custom-font`). The shape, in the README's own words:

> *"Add your font files (.woff, .ttf, .woff2 and .otf) to your vault's `.obsidian/fonts` folder."*
> *"This plugin leverages base64 encoding to ensure maximum compatibility across platforms."*
> *"you won't even need to install the font on your operating system"*
> *"Open the plugin settings and choose your desired font from the dropdown menu."*
> *"This plugin is created since currently obsidian doesn't support setting custom fonts easily. This
> is the case, especially in Android and IOS."*

**This is exactly `media/kit/fonts/`:** a **directory the user drops files into**, **indexed** into a
**dropdown**, applied without any OS involvement, explicitly motivated by **Android**. Four accepted
formats. It replaces Obsidian's typed-name string with a **picker over what is on disk** — the
single most important improvement to copy.

### 7.3 · Penpot — the *upload* model (and its edges)

**VERIFIED** (Penpot Help Center, *Custom fonts*):

> *"You can upload fonts with the following formats: TTF, OTF, WOFF and WOFF2. Only one format will
> be needed."*
> *"Fonts with the same font family name will be grouped as a single font family"* — variants
> (Light, Bold) join a family by **matching the family name entered at upload time**.
> *"You should only upload fonts you own or have license to use in Penpot."*

Two carry-overs: **(a) the family/variant grouping key is a user-controlled string**, which is how
weights and italics get attached to one family; **(b) the licence disclaimer is stock and belongs in
our gallery hint too.** One anti-carry-over: Penpot has an **upload endpoint**. We must not — §5.4 of
GACHA_PLAN ruled option (b): *there is no write API and there must never be one*, because the tailnet
is the only boundary. Drop-in over SSH is our upload.

### 7.4 · VS Code — the counter-example worth naming

**REPORTED** (microsoft/vscode issues #146983, #85101, #50407, #52631). `editor.fontFamily` takes a
family **name only**; the font must be installed in the OS; an unrecognised name silently degrades to
a default; the recurring user remedies are *install it, quote it, restart*. **The lesson is the
failure mode:** a name-typed setting with no index behind it produces "it silently did nothing", which
is the exact class of bug the M4 background round already cost us once (the owner dropped a file, saw
nothing, and read the app as broken — MEDIA_PLAN §12.1). **Do not ship a typed family name.**

### 7.5 · fontconfig / KDE — the OS answer

**REPORTED** (ArchWiki *Font configuration*; KDE UserBase *System Settings/Font*). Fonts are
**registered by placing files in scanned directories** — `/usr/share/fonts/` and
`~/.local/share/fonts` — and configuration then selects them **by family name**; KDE's font KCM
**rewrites the user's fontconfig file** when used. Nova Launcher, for its part, **has no native font
support at all** (REPORTED). Two carry-overs: the **scan-a-directory** registration is the universal
convention (and is what we already do for art); and **"the settings UI overwrites the config file"** is
the mirror of a hazard we already handle (the gallery's persisted `order` list).

## 8. The web-platform mechanics (what the browser will actually do)

### 8.1 · Registering a font from a same-origin static file

Two routes, both **VERIFIED** against MDN/spec:

- **CSS `@font-face` + `src: url(...)`** — the shipped pattern (`fonts/faces.css`, generated).
- **The CSS Font Loading API** — `new FontFace(family, source[, descriptors])` where *family*
  *"Specifies a font family name that can be used to match against this font face"*, *source* is
  either *"A URL to a font face file (CSS `url()` string)"* or *"Binary font face data in an
  ArrayBuffer or a TypedArray"*, and descriptors include `style`, `weight`, `display`,
  `unicodeRange`, `ascentOverride`, `descentOverride`, `lineGapOverride`. A constructed face becomes
  usable via `await font.load()` then `document.fonts.add(font)`.

**For owner-supplied files the FontFace API is the right one**, for a reason that is not ergonomics:
the family name is a **JavaScript string**, never parsed as CSS. Building an `@font-face` rule by
string-concatenating an owner filename would be a **CSS-injection surface**. (Our mount URLs are
already percent-encoded per segment — `core/media.py#file_url` uses `urllib.parse.quote` — so `"` and
`)` cannot survive into the `url()`; **VERIFIED from the code**. That is defence in depth, not the
plan.)

We already own the *waiting* half of this: `themes/gacha/fonts.ts` does
`await import("./fonts/faces.css")` then `document.fonts.load(...)` for each face **before**
`switchTheme` flips the skin, so activation paints without FOUT. A dropped font slots straight into
that function.

### 8.2 · `font-display` — what each value actually promises

**VERIFIED** (MDN, `@font-face/font-display`). The timeline has three periods: during the **block
period** an unloaded face renders *"an invisible fallback font face"*; during the **swap period** it
renders *"a fallback font face"*; after that the load is treated as failed. The values:

> `auto` — *"The font display strategy is defined by the user agent."*
> `block` — *"Gives the font face a short block period and an infinite swap period."*
> `swap` — *"Gives the font face an extremely small block period and an infinite swap period."*
> `fallback` — *"…an extremely small block period and a short swap period."*
> `optional` — *"…an extremely small block period and no swap period."*

Our generated faces use `swap` (VERIFIED, `faces.css`), and §10.4 explicitly ruled `swap` **plus** the
await-before-flip. That combination is right for a dropped font too — **but the await must be
bounded** (§9.5): the owner's file could be a 12 MB CJK TTF, and blocking theme activation on it turns
a font drop into a hang.

### 8.3 · `size-adjust` and the metrics overrides

**VERIFIED** (MDN, `@font-face/size-adjust`): *"All metrics associated with this font are scaled by
the given percentage. This includes glyph advances, baseline tables, and overrides provided by
`@font-face` descriptors"*, the purpose being *"to harmonize the designs of various fonts when
rendered at the same font size"*; baseline-widely-available since **September 2023**. Siblings:
`ascent-override`, `descent-override`, `line-gap-override` (also exposed as FontFace descriptors,
§8.1).

**Our position, and it should not change:** §10.4 already ruled *"skip `size-adjust` tuning"* for the
bundled faces. For an **owner-dropped** face there is nothing to tune *against* — we cannot know its
metrics without parsing it (§5.4), so a size-adjust value would be a guess. The correct mitigation for
a wildly-off dropped face is **layout that does not depend on the metrics**: the dossier `h2` already
has `line-height: 1` and `overflow-wrap: anywhere` (VERIFIED, `gacha.css:1846,1852`), which is most of
the way there. **UNVERIFIED risk to check on device:** a very tall-metric dropped face could still
overflow the reserved `padding-right: 60px` close-corner lane.

### 8.4 · Format acceptance, MIME, and CORS

- **WOFF2 is the only format worth accepting.** **VERIFIED (IANA media-types registry):** `font/woff2`
  is registered per **RFC 8081** (registered 2016-12-21); `font/woff` likewise; and
  `application/font-woff` is listed as *"DEPRECATED in favor of font/woff"*. Serve `font/woff2`.
- **TTF/OTF work in browsers but are 2–5× larger** and gain us nothing — except the one thing in
  §5.4 (they are the only formats whose `name` table we could read without a dependency).
- **CORS:** same-origin `@font-face` fetches need no `Access-Control-Allow-Origin`. Our mount is
  same-origin under `/api/media/…` (VERIFIED — the D52 §10.4 placement ruling exists precisely so it
  works in both the dev-proxy and prod profiles). **If the mount ever moved to a different origin,
  font loads would break where images would not** — worth a comment where the route is registered.

### 8.5 · Security of serving owner-supplied font binaries same-origin

**Font files are inert content, unlike SVG/HTML** — the stored-XSS reasoning that produced
`ALLOWED_TYPES` does not extend to woff2. The residual risk is the **parser**, and it is handled by
the browser, **VERIFIED** (`khaledhosny/ots` README):

> *"The OpenType Sanitizer (OTS) parses and serializes OpenType files (OTF, TTF) and WOFF and WOFF2
> font files, validating them and sanitizing them as it goes."*

The C library *"is integrated into both Chromium and Firefox"*, and its stated motivation is that
system TrueType renderers *"hadn't previously been exposed to attack surfaces"* before webfonts —
particularly where font rendering runs with elevated privileges. So **every browser that would render
an owner-dropped font already sanitizes it before the platform sees it.** Our obligations reduce to
the ordinary three we already meet: the extension allowlist, `X-Content-Type-Options: nosniff`, and
the `is_served_file` regular-file/symlink predicate.

**The genuinely new hazard is not memory safety, it is *lock-out*.** A dropped font can render the
entire UI unreadable (a dingbat/symbol face bound to `--font-body`), including the Conf gallery you
would use to remove it. Precedents do not solve this — Obsidian's answer is "edit the vault";
fontconfig's is "delete the file". **Our answer must be a synced kill-switch** (§9.6).

## 9. What `media/kit/fonts/` would need — the seam, answered

Read against the as-built `brand` role (MEDIA_PLAN §12.1), which is the cheapest precedent we own.

### 9.1 · Backend: how much of it is free

**VERIFIED from `core/media.py`** — a new role is one tuple entry, and the registry drives
*ensure-dir → mount → index → health/degrade*: `KIT_ROLES` gains `"fonts"`. Free with it:
`revision` (`f"{st.st_mtime_ns}:{st.st_size}"`), the ruled collation, the `unusable_reason` verdict,
the mount's two gates, the SW route (`/^\/api\/media\/[^/]+\/files\//` — namespace- and role-agnostic,
VERIFIED `vite.config.ts:111`). **No wire-shape change** — same as the M4/G6.3 finding.

### 9.2 · The one real backend delta — `ALLOWED_TYPES` must become per-role

**VERIFIED, this is the blocker.** `ALLOWED_TYPES` (`core/media.py:121`) is a **single module-level
dict** consulted in three places: the mount's type gate (`api/media.py:118`), the listing filter
(`core/media.py:568`), and `describe_file`'s extension-vs-magic mismatch check (`:530`). Adding
`.woff2` to it would make **woff2 servable and listed in every role of every namespace** —
`gacha/characters/`, `kit/hosts/`, everything.

**The shape the directive prescribes** (CLAUDE.md: *"one unified per-item object you extend with an
optional field"* over parallel maps): promote the role from a bare string to a per-role object —

```python
MediaNamespace(roles={"background": RoleDef(), "brand": RoleDef(), "fonts": RoleDef(types=FONT_TYPES)})
```

— with `RoleDef.types` defaulting to the image allowlist. That is one migration of a
`tuple[str, ...]` (three namespaces, twelve roles, all internal — no config, no wire), and it is the
last time the question is asked: the next role that needs its own types is an argument, not a refactor.
A sibling `ROLE_TYPES: dict[tuple[str, str], …]` map beside `MEDIA_NAMESPACES` would be exactly the
banned shape.

### 9.3 · `probe_image` needs a font arm — and it is trivial

**VERIFIED** (W3C WOFF2 spec): *"The signature field in the WOFF2 header MUST contain the value of
0x774F4632 ('wOF2')"*. Four bytes at offset 0, readable with the same stdlib `struct` idiom
`probe_image` already uses. `width`/`height` stay `None` — the model already allows it
(`MediaFile.width: int | None`), and the FE's advisory bounds become a **byte ceiling** instead of a
megapixel one (the `ICON_ART`-style per-role bounds registry is already the home for that).

### 9.4 · **The server can never read the font's real name** — so the stem is the binding

**VERIFIED, and it settles the API shape.** WOFF2 compresses *"the data for the font tables … in a
single data stream comprising all the font tables"* with Brotli, and *"the table directory cannot be
read without decompression"* (W3C WOFF2 spec). The backend venv has **no `brotli`, no `brotlicffi`,
no `fontTools`** (VERIFIED — probed `backend/.venv`, Python 3.14.4; stdlib gained
`compression.zstd` in 3.14, never brotli). So reading a dropped woff2's `name` table means **a new
runtime dependency** — the exact thing §10.4 refused for images ("no Pillow: a new runtime dep AND an
untrusted-decoder surface"), and the argument is stronger here, since the decoder would be reading
attacker-shaped compressed data on the server rather than in the browser's sanitizer.

**Therefore: bind by FILENAME STEM, and invent the family name.** This is not a compromise — it is
the kit's existing `named`-role convention (MEDIA_PLAN §2: *"files bind to NAMES by casefolded stem
match"*; `frontier/stack` binds `cube`/`platform-mid`/`platform-base` with **no pin and no config,
because the filename IS the binding**). A `fonts` role is a **`named` role with static keys
`display` / `body` / `mono`** — one key per `--font-*` token role, mirroring `theme-engine/kit/tokens.css`
(`--font-body`) and the themes' `--font-display`/`--font-mono`.

```
$CTRLB_HOME/media/kit/fonts/
  display.woff2      → --font-display
  body.woff2         → --font-body
  mono.woff2         → --font-mono
```

Empty folder ⇒ byte-identical to today. A partial drop overrides only its own token — exactly the
`frontier/stack` per-key composite behaviour that already has a test matrix.

### 9.5 · The `@font-face` ↔ `revision` interaction (the thing that would bite)

The owner's repair is `scp display.woff2 emma:…/fonts/` — **same name, new bytes**. Every cache on the
path is keyed on a URL that did not move. We already own the answer: `lib/media.ts#revUrl` appends
`?rev=<mtime_ns:size>`, *"the query moves only when the bytes move, so a poll still hits"* (VERIFIED,
`media.ts:182–189`; the SW route matches on `url.pathname`, so the query changes which cache entry it
is, never whether it is cached).

**But a font has a second, longer-lived cache the images do not: `document.fonts`.** Three concrete
consequences:

1. **Construct the FontFace with the `?rev=`-stamped URL** — `revUrl` applies unchanged.
2. **Delete the previous FontFace before adding the new one.** Two faces with identical
   family/weight/style both live in the `FontFaceSet`, and which one wins is a matching-order question
   I did **not** verify (**UNVERIFIED** — I did not read the CSS-Font-Loading matching order). Do not
   depend on it: keep the handle, `document.fonts.delete(old)`, then `add(new)`.
3. **Bound the await.** `themes/*/fonts.ts` currently awaits `document.fonts.load(...)` before the skin
   flips. An owner file has no size ceiling on disk, so the await needs a **`Promise.race` timeout**
   plus `font-display: swap` — the theme must activate even if the font never arrives. (The existing
   `try { … } catch { /* fall back to font-display behaviour */ }` in `gacha/fonts.ts` is the right
   instinct; a rejected promise is handled, a slow one is not.)
4. **Failure is only observable in the client**, and the primitive exists: a valid-looking woff2 that
   OTS rejects fails at `FontFace.load()`, not at the index. `lib/media.ts#artIdentity(url, revision)`
   — *"NUL-joined … so two different pairs can never spell the same identity"* — is already the
   reel-figure failure latch, and is the right key for a font failure latch too (**reuse, do not
   re-invent**).

### 9.6 · Which token, whose theme — the one question I cannot answer for the session

**Flagged, not ruled.** `--font-display` is theme-owned typographic identity (vapor's *Major Mono
Display*, cosmos's *Audiowide*, frontier's *Chakra Petch*, gacha's *Shippori Mincho B1* — VERIFIED,
four themes' `tokens.css`). MEDIA_PLAN's **A5 surface-scoped precedence matrix** says *"theme-owned
surfaces never consult kit roles"* — read strictly, that forbids a kit font role from touching
`--font-display` at all.

Two readings, and the session must pick:

- **(i) The `background`/`brand` reading — a drop always wins, app-wide.** Precedence per role:
  *owner file → the theme's own declaration → the kit default.* Simple, matches the two most recent
  owner rulings, and the removal is `rm`. Cost: one dropped `display.woff2` restyles **all four
  themes at once**, which is either the point or a surprise.
- **(ii) Per-theme, under `media/<theme>/fonts/`.** Faithful to A5, and gacha could carry a
  display face vapor never sees. Cost: **four folders for one idea** — the exact "duplicated systems"
  the owner ruled against on 2026-08-06 when `gacha/wallpaper/` was deleted in favour of
  `kit/background/`.

**My reading, offered as evidence not a ruling:** (i), with the §12.1 precedent, *plus* the
`kit_background_visible` precedent as the **lock-out escape** — a nullable synced
`kit_fonts_enabled` on `AppearanceCfg` (VERIFIED shape: `bool | None`, unseeded-until-written, so a
pre-existing config keeps the client's local value). That switch is what makes a dingbat drop
recoverable from the phone instead of over SSH, and §8.5 says we need such an escape regardless of
which reading wins.

### 9.7 · Weights and italics from a single dropped file

A drop gives one file; the dossier `h2` asks for `900 italic`. Options, cheapest first:

- **v1 — register the file at all weights, let synthesis handle the rest.** `new FontFace(fam, src,
  { weight: "1 1000", style: "normal" })`. Honest, one file, and it is **no worse than what ships
  today** (§0.1 — the current name is already synthesised). Document it in the gallery hint.
- **The additive extension, if ever wanted — a stem suffix.** `display.woff2`,
  `display-italic.woff2`, `display-700.woff2`. This is Penpot's family-grouping (§7.3) expressed
  through the filename instead of an upload form, and it composes with the stem-binding of §9.4
  without any config shape moving. **Do not build it in v1**; note that it is additive so the v1
  contract does not have to pretend the question does not exist.

---

## 10. Implications (short and separate — this is our reading, and it ages faster than §1–§9)

1. **The font question is really a bug report.** The dossier name is a synthetic shear of a Japanese
   mincho at a weight the face does not publish. Any of the four shortlist faces fixes it and is
   *smaller*. The session's cheapest possible outcome is a token swap with a net byte saving.
2. **Decide "replace `--font-display`" vs "mint `--gc-dossier-name-font`" first** — it is the fork that
   decides whether the choice costs 0 KB or ~16 KB, and it is a *design* question (does the app-bar
   subtitle and the fleet `h1` want to move too?), not a technical one.
3. **Prefer a non-RFN face** and §4's licence paragraph never has to be re-litigated. That quietly
   demotes Playfair Display and rules out Orbitron.
4. **The genre evidence points away from the serif.** If "reads like a gacha game" is the goal rather
   than "matches the mock", Archivo/Kanit italic is the honest answer and the session should say so
   out loud before locking the serif.
5. **The font system is a `brand`-sized slice, not a project** — with exactly two things that are not
   free: per-role `ALLOWED_TYPES` (§9.2, and it is the directive's own unified-object refactor) and a
   bounded await + FontFace delete/add on revision change (§9.5).
6. **Do not let the server read fonts.** Stem-binding is both the no-dependency answer *and* the
   convention the kit already uses; a `fontTools`/`brotli` dependency to show a nicer name in a picker
   would buy a decoder surface for a cosmetic string.
7. **Ship the kill-switch with the feature, not after it.** A bad font is the first owner-droppable
   asset that can make the UI that removes it unreadable.

---

## 11. What I could not determine

- **How any candidate actually looks at 27 px on the owner's Fennec, over a tinted gradient with the
  watermark at 0.16.** No device round in this pass. This is *the* open question and the reason
  `font-specimens.html` exists — especially for **Bodoni Moda**, whose hairlines are the one
  identified failure risk in the shortlist.
- **Whether the JP glyph coverage of a replacement matters.** Every candidate's *latin* subset is
  measured; I did **not** measure whether replacing `--font-display` breaks the **frozen 68-glyph JP
  subset** the same token serves (`gacha.css:73`, `:452` — the app-bar subtitle and nav sub-labels are
  Japanese). Only the four **Zen** faces and Shippori have JP coverage at all; picking a Latin-only
  display face means `--font-display` must **stay Shippori for the JP surfaces** and the new face must
  be a *second* token. **This materially changes implication 2 and should be checked first in the
  session.**
- **The FontFaceSet matching order** when two faces share family/weight/style (§9.5 ②). Sidestepped by
  deleting explicitly; not read from the spec.
- **Whether a dropped face with extreme vertical metrics overflows the dossier title block** (§8.3) —
  needs a device or a Playwright pass with a deliberately bad font.
- **Genshin/Star Rail typography beyond the fan wikis.** The Genshin wiki page returned HTTP 402 to my
  fetcher; both games' entries here are second-hand search summaries. The Arknights entry is the only
  one I read at source, and it does **not** corroborate the "Oswald for names" claim.
- **Whether Google's own RFN-subset practice (§4) has ever been tested.** Low-confidence area; the
  recommendation routes around it rather than resolving it.
- **Real-world sizes for owner-dropped fonts.** No precedent app documents a size limit (Penpot
  states none), so the byte ceiling in §9.3 has no field anchor — pick it from our own render budget.

---

## 12. Sources

**Type files + licences (primary, fetched 2026-08-06)**
- `https://raw.githubusercontent.com/google/fonts/main/ofl/<slug>/METADATA.pb` and `…/OFL.txt` for all
  **30 families** in §3 — fetched individually, one request per file (designer · `license: "OFL"` ·
  category · published styles/weights · the `OFL.txt` line-1 copyright, which is where an RFN is
  declared). Every one returned from the `ofl/` directory; none needed the `apache/`/`ufl/` fallback.
- Google Fonts CSS2 API — `https://fonts.googleapis.com/css2?family=…` (subset blocks, `text=`
  subsetting, the HTTP 400 on `Shippori Mincho B1:ital`), and `fonts.gstatic.com` for the byte counts.
- SIL Open Font License FAQ — https://openfontlicense.org/ofl-faq/ (2.2, 2.2.1, 2.6, 2.7, 2.8).

**Web platform (primary)**
- MDN, `@font-face/font-display` — https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display
- MDN, `@font-face/size-adjust` — https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust
- MDN, `font-synthesis` — https://developer.mozilla.org/en-US/docs/Web/CSS/font-synthesis
- MDN, `FontFace()` — https://developer.mozilla.org/en-US/docs/Web/API/FontFace/FontFace
- W3C, *WOFF File Format 2.0* — https://www.w3.org/TR/WOFF2/
- IANA media-types registry (RFC 8081: `font/woff2`, `font/woff`; `application/font-woff` deprecated) —
  https://www.iana.org/assignments/media-types/media-types.xml
- OpenType Sanitizer — https://github.com/khaledhosny/ots

**User-supplied-font precedents**
- `pourmand1376/obsidian-custom-font` — https://github.com/pourmand1376/obsidian-custom-font (README, quoted)
- Penpot Help Center, *Custom fonts* — https://help.penpot.app/user-guide/custom-fonts/ (quoted)
- Obsidian custom-font write-ups (REPORTED): https://hoverbear.org/blog/custom-fonts-obsidian/ ·
  https://kau.sh/blog/custom-fonts-obsidian-mobile/
- microsoft/vscode issues #146983 · #85101 · #50407 · #52631 (REPORTED, via search index)
- ArchWiki *Font configuration* — https://wiki.archlinux.org/title/Font_configuration ·
  KDE UserBase *System Settings/Font* — https://userbase.kde.org/System_Settings/Font

**Game typography (REPORTED — fan wikis / fan inventories)**
- `TimWangZi/The-font-of-Arknights` — https://github.com/TimWangZi/The-font-of-Arknights (read at source)
- Genshin Impact Wiki, *Typeface* — https://genshin-impact.fandom.com/wiki/Typeface (HTTP 402 to the
  fetcher; second-hand)
- Honkai: Star Rail Wiki, *Typeface* — https://honkai-star-rail.fandom.com/wiki/Typeface (second-hand)
