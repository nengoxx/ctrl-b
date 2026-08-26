# R60 — How shipped products decide WHICH image a destination paints

**Date:** 2026-08-26 · **Bounded pass, one agent, no subagents.** · **Draft — main seat curates the index row.**

**The question (owner, 2026-08-26).** ctrl-b's media manager models "which image does a destination
paint" as: every destination owns one **ordered LIBRARY** (bundled defaults + owner uploads in one
list) where **ORDER is the only priority** — top wins in first-wins destinations, dealt positionally
in fleet deals, all shown in carousels — plus a per-image **In-use toggle** that switches an entry out
of resolution **in place** (position unchanged, dimmed), and **no "set active" control anywhere**
("make it active" = move it to the top). Two gacha seats pin one named entry of another
destination's library. *Is this the right system model, or does the field do this better?*

**Relationship to [R59](./R59-art-library-presentation.md).** R59 surveyed **wallpaper/CMS pickers**
and found order-decides-active had **no precedent** there (0/6), and recommended shipping an explicit
"Set as active" implemented as move-to-front. The owner **overruled that** on 2026-08-26 (D66 — *"the
order should be the only thing… we don't need two systems to do one thing"*). This pass is the
follow-up: **who else ships order-as-priority + a membership toggle, and what do the ones who don't
ship instead?** It deliberately leaves R59's reference class alone (Signal · Telegram · AOSP · GNOME ·
Gutenberg/WP · Navidrome now-playing · tvOS · iOS · Windows · HA · Notion are **not** re-bought here)
and goes after the classes R59 never opened: **media-server artwork**, **cover-art resolvers**,
**e-commerce product media**, **desktop slideshow membership**, and the **peer LLM apps**.

---

## Confidence legend

- **[V]** — I read the source file / config at the stated ref and quoted it.
- **[V-doc]** — quoted from an official vendor doc I fetched.
- **[R]** — reported by a secondary source (press, community, search summary of a doc I could not fetch).
- **[U]** — expected but unverified; called out as such.

---

## §0 — TL;DR: the verdict facts

1. **R59's "no precedent" verdict was true of its reference class and is FALSE of the field at large.
   Order-as-the-only-priority is a mainstream, shipped, documented model** — it just lives in
   media-server and resolver software, not in wallpaper pickers. Jellyfin's shipped help string is
   our design sentence verbatim: **"Enable and rank your preferred image fetchers in order of
   priority."** **[V]**

2. **Our exact pair — ordered list + in-place enable checkbox, in ONE list — is shipped by
   MusicBrainz Picard, and its storage shape is character-for-character ours.** `ca_providers` is a
   list of `(name, enabled)` tuples; the default ships **a disabled entry sitting in place at
   position 4**: `DEFAULT_CA_PROVIDERS = [('CaaReleaseGroup', True), ('Cover Art Archive', True),
   ('UrlRelationships', True), ('Local', False)]` **[V]**. The docs state the resolution rule with no
   second mechanism: *"You can activate more than one provider and choose the order in which the
   providers are queried… Picard will try the providers from top to bottom until an image is
   returned."* **[V-doc]**

3. **But every order-as-priority product ranks SOURCES/KINDS, not individual candidate images.**
   Picard ranks providers; beets ranks `sources`; Navidrome ranks filename patterns
   (`coverartpriority = "cover.*, folder.*, front.*, embedded, external"` **[V]**); Jellyfin ranks
   fetchers. **ctrl-b applies the same mechanism one level down — to the individual pictures. That
   substitution is the actual novelty, and no product I read makes it for a single-image
   destination.** **[V ×4]**

4. **Where a product does let ORDER pick one image out of many, it is e-commerce, and it is exactly
   our rule.** Shopify: *"The first media item for each product is known as the featured, or main,
   media item"*, changed by dragging the image into first place — there is no "make featured" control
   in the web admin **[V-doc]**. Etsy: the first photo is the listing thumbnail, reordered by drag
   **[R]**. **These are the closest true analogues to our model that ship.**

5. **…and BOTH of them buy back an explicit verb or a mode on the PHONE.** Shopify's mobile app
   ships *"Set as default"* on the image's overflow menu **[V-doc]**; Etsy's app ships a dedicated
   **Reorder** mode with an explicit Save **[R]**. Two products that chose order-decides-active on
   desktop both concluded that on a touch screen dragging alone is not enough. **This is the single
   most decision-relevant finding for a phone-first app.**

6. **The membership half — an in-place toggle over an image grid — also ships, in KDE Plasma.** The
   wallpaper grid's delegate draws a `CheckBox` on each thumbnail, `visible:
   configDialog.currentWallpaper === "org.kde.slideshow"`, `onToggled: model.checked = checked`,
   persisted as `cfg_UncheckedSlides` — an **exclusion list**, the row keeps its place. **[V]**

7. **Nobody composes the two halves over images.** Picard/beets/Navidrome/Jellyfin = order+membership
   over **sources**; Shopify/Etsy = order over **images** with no membership toggle at all (Shopify's
   docs offer no way to hide a media item without removing it **[V-doc]**); KDE = membership over
   **images** with no hand-order (its "Order" combobox offers only *Random · A to Z · Z to A · Date
   modified (newest first) · (oldest first)* — a **sort mode, never a hand-arrangement**) **[V]**.
   **ctrl-b's model is the composition of three shipped halves, not an invention — and not a
   precedent either.**

8. **The single-explicit-pointer model still dominates for "one destination, one image", and its
   defining feature is that the CURRENT image is an entry in the candidate list.** Kodi builds the
   chooser as `thumb://Current` → `thumb://Embedded` → `thumb://Remote{0..n}` → `thumb://Local` →
   `thumb://None` → Browse, then `PersistArt(result)`; there is no ordering or priority anywhere in
   the flow **[V]**. Plex marks the chosen poster with a check mark at its top-right **[R]**.

9. **The one documented confusion of order+membership is worth pre-empting: unchecked rows still
   occupy positions, and users read position as intent.** Radarr/Sonarr quality profiles (checkbox +
   drag, the mainstream homelab instance of this shape) require third-party guides to explain that
   *"qualities higher in the list are more preferred even if not checked"* **[R]**. Our semantics are
   the kinder ones (a hidden entry is inert, not silently ranking) — but the **picture** on screen is
   identical, so the copy has to carry it.

10. **Peer LLM-app class: a verified nothing.** open-webui stores exactly one background image —
    `let backgroundImageUrl: string | null = null;`, one button that reads `Upload` or `Reset` **[V]**.
    AnythingLLM replaces one logo **[V-doc]**; LibreChat's answer is dropping files into
    `client/public/assets` and rebuilding **[R]**. **No peer has a library, an order, or a membership
    concept. There is nothing to copy and nothing to be contradicted by.**

---

## §1 — Provenance

**Read at source (fetched at HEAD/`master` on 2026-08-26):**

- **metabrainz/picard** — `picard/ui/options/cover.py`; `picard/const/defaults.py`.
- **jellyfin/jellyfin-web** — `src/components/imageeditor/imageeditor.js`;
  `src/components/libraryoptionseditor/libraryoptionseditor.js`;
  `src/components/imageDownloader/imageDownloader.js`; `src/strings/en-us.json`.
- **navidrome/navidrome** — `conf/configuration.go`.
- **xbmc/xbmc** — `xbmc/video/dialogs/GUIDialogVideoInfo.cpp` (`ManageVideoItemArtwork`).
- **KDE/plasma-workspace** — `wallpapers/image/imagepackage/contents/ui/{config.qml,WallpaperDelegate.qml}`;
  `wallpapers/image/slideshowpackage/contents/ui/SlideshowComponent.qml`.
- **open-webui/open-webui** — `src/lib/components/common/InterfaceSettings.svelte`;
  `src/lib/components/chat/Settings/Interface.svelte`; `src/lib/i18n/locales/en-US/translation.json`.

**Docs fetched [V-doc]:** MusicBrainz Picard *Cover Art Options* (v3.0);
beets *fetchart* plugin (stable); Shopify Help Center *Adding product media*;
AnythingLLM *Appearance Customization*.

**Secondary only [R]:** TRaSH Guides + Servarr wiki (Radarr/Sonarr quality profiles); Plex support
*Edit Details* (**403 to the fetcher** — content via search summaries of that page and two how-to
articles); Etsy Help *How to Edit Your Listing Photos* (**403**, same treatment); Steam community
guides (custom artwork); Wallpaper Engine Steam discussions (playlist order).

**Fetch failures worth recording so nobody re-buys them:** `kodi.wiki` returns **403** to the fetcher
on both the article URL and `?action=raw` — Kodi had to be read from source instead (which was
better). `support.plex.tv` and `help.etsy.com` also 403. `help.shopify.com` fetches fine.

---

## §2 — The taxonomy of shipped activation models

| # | Model | How the choice is expressed | Named products | How "what is live" is shown |
|---|---|---|---|---|
| **A** | **Single explicit pointer** ("set this one") | tap/click a candidate; a stored id | Kodi **[V]** · Jellyfin primary image **[V]** · Plex **[R]** · Steam custom artwork **[R]** · Signal/Telegram/AOSP/GNOME/WP (R59) | The current image is **an entry in the candidate list** (Kodi `thumb://Current`) and/or a check mark on the chosen tile (Plex, AOSP, GNOME) |
| **B** | **Ordered priority chain, order = the only priority** | drag / ↑↓ a list; first that yields wins | Picard providers **[V]** · beets `sources` **[V-doc]** · Navidrome `*artpriority` **[V]** · Jellyfin fetcher order **[V]** | **Not shown at all.** The ranking list displays name + checkbox + arrows and nothing else; the result is seen at the destination |
| **B′** | **Ordered priority over the IMAGES themselves** | drag the picture to position 1 | Shopify featured media **[V-doc]** · Etsy thumbnail **[R]** · *(ctrl-b)* | Implicit — position 1 **is** the answer; Shopify's admin shows the media grid in order, no badge **[V-doc]** |
| **C** | **Membership set + rotation/sequence** (order is a sort mode or irrelevant) | per-item checkbox or opt-out; a separate order/shuffle control | KDE Plasma slideshow **[V]** · Wallpaper Engine playlists **[R]** · tvOS Aerials, iOS Photo Shuffle, Windows slideshow (R59) | Nothing per-item; AOSP substitutes a **word** ("Daily wallpaper", R59) |
| **D** | **Pin + fallback chain** | one override above a default | Steam Set/Clear custom artwork **[R]** · *(ctrl-b's two gacha seats)* | The override is either present or cleared; "Clear" restores the shipped default |
| **E** | **Ordered set, all shown** | drag to sequence | Jellyfin backdrops (`ImageIndex`, Move Left/Right) **[V]** · e-commerce galleries · *(ctrl-b carousels)* | Every member is live; order is sequence, not priority |

**Two structural notes the table hides:**

- **A and B are not competitors — they are different altitudes.** Jellyfin ships **both at once**:
  model B for *which fetcher supplies art*, model A for *which image is the primary*. Nobody offers
  B at the image altitude **and** A as well. **[V]**
- **B′ and E are the same storage with different semantics** — an ordered image list read either "top
  wins" or "all, in this order". Jellyfin runs E over backdrops while its primary image is a single
  A-slot. ctrl-b runs B′, E **and** a positional deal off **one** list shape; that multi-reading is
  ours, the individual readings are all shipped.

---

## §3 — The three friction points, model by model

### (a) Making one image live in one tap

| Model | The gesture | Cost |
|---|---|---|
| **A** | one tap on the tile (or tap → preview → "Set") | **1 tap.** This is the model's whole reason to exist |
| **B/B′** | move it to position 1 — a drag, or *n* × ↑ | **1 drag or n taps.** Shopify's web admin has literally no other way **[V-doc]** |
| **B′ on a phone** | Shopify: overflow → **"Set as default"**; Etsy: enter **Reorder** mode, drag, **Save** | Both added a phone-specific affordance rather than trust the drag **[V-doc / R]** |

**The finding:** the field agrees order-as-intent is fine on a mouse and insufficient on a finger.
Neither e-commerce product removed the ordering model to fix it — they **added a verb (Shopify) or a
mode (Etsy)** on top of it. ctrl-b's `promote` rider in D66 (move-to-top for the scoped sections) is
the same instrument under a different name; the open question is only whether it should be present
everywhere rather than only where reorder is impossible.

### (b) Excluding an image without deleting it

- **Ships, in place, over images:** KDE Plasma — per-thumbnail checkbox → `cfg_UncheckedSlides`;
  the tile stays where it is **[V]**. tvOS Aerials: *"select a thumbnail to hide it"* (R59 **[V-doc]**).
- **Ships, in place, over sources:** Picard (`('Local', False)` **shipped disabled at position 4**)
  **[V]**; Jellyfin fetchers (checkbox independent of the ↑↓ buttons) **[V]**; Radarr qualities **[R]**.
- **Does not exist:** Shopify — the help page documents no way to hide a media item; you remove it
  **[V-doc]**. Kodi/Plex/Steam — a single pointer has nothing to exclude. Signal — no delete UI at all,
  uploads are GC'd when unreferenced (R59 **[V]**).

**The finding:** **the toggle is the field-normal answer wherever a SET is resolved**, and is absent
wherever a POINTER is stored. ctrl-b resolves sets (rosters, deals, carousels) *and* points (first-wins
backgrounds) from one list — so it needs the toggle for the set half, and inherits it on the pointer
half where the field would not have one. **That inheritance is defensible but it is the seam where a
user can build a state the field never produces: a dimmed row sitting above the winner.**

### (c) Showing which images are currently in use

- **Model A products always show it, and the cheapest shipped form is putting the current image into
  the candidate list as its own entry** — Kodi's `thumb://Current` at the head **[V]**; Plex's
  top-right check mark **[R]**; R59's AOSP bottom-end check-circle.
- **Model B products never show it.** Picard's, Jellyfin's and Radarr's ranking lists render name +
  checkbox + arrows; there is no marker for "this is the one that actually answered last time"
  **[V ×2, R]**. beets and Navidrome have no UI at all — the priority is a config line
  **[V-doc / V]**.
- **Model C products show a word, not a mark** (AOSP "Daily wallpaper", R59) or nothing (KDE,
  Windows).

**The finding:** **ctrl-b's gallery is ahead of the field here, not behind it.** Marking the *winner*
(accent outline + "Active" chip) inside the *ranking list* is something no model-B product does, and
it is the exact affordance that makes order-as-priority legible without a second control. The
corresponding obligation is that the chip may never lie — which is precisely why MEDIA_MANAGER_PLAN
§2.4 makes the claim come from the theme's own resolver rather than from the config value.

---

## §4 — The verdict

**Does any shipped product use order-as-the-only-priority with an in-place membership toggle?**
**Over sources: yes, several, and it is the documented mainstream** (Picard, Jellyfin, beets,
Navidrome, Radarr). **Over individual images: no product ships both halves together.** Shopify and
Etsy ship order-decides-active over images with no toggle; KDE ships the toggle over images with no
hand-order.

**The closest analogue, and what it does instead.** **Jellyfin is the closest single product**: same
sentence ("enable and rank… in order of priority"), same widgets (checkbox + ↑↓ in one row), and it
faces our exact multi-altitude problem. Its answer is to **split by altitude** — ranking for
*sources*, an explicit pointer for the *image*, an index order for *backdrops* — three surfaces, three
vocabularies, and the user never has to ask which reading applies to the list in front of them.
**ctrl-b's bet is the opposite: one vocabulary, and the destination tells you the reading.**

**What theirs avoids that ours can hit:**

1. **The dimmed-row-above-the-winner state.** Radarr's documented user confusion (*"higher in the list
   are more preferred even if not checked"* **[R]**) is proof that mixed checked/unchecked ordered
   lists mislead — and Radarr at least has a *reason* for the unchecked row's position. In a first-wins
   ctrl-b section a switched-off entry above the active one is pure noise, and the reader's first
   question is "why isn't that one used?". Split-altitude designs never produce the picture.
2. **One-tap activation on a touch screen.** Both order-decides-active products in the field paid for
   a phone affordance. We ship drag + ↑/↓ + move-to-top-in-detail, which is the same payment — but it
   is currently framed as *reordering*, not as *choosing*, and the field's phone answer is framed as
   choosing ("Set as default").
3. **Ranking lists are usually invisible.** Picard/beets/Navidrome hide the priority chain in a
   settings pane or a config line precisely because it is machinery. Ours is the primary UI, which
   raises the legibility bar — and is why §3(c)'s Active chip is load-bearing rather than decorative.

**What ours does better, on its own terms:**

1. **It is the shape that survives a hand-edited YAML file.** Every model-B product stores exactly
   what we store — an ordered list carrying per-entry enablement (`ca_providers = [(name, bool)]`
   **[V]**; beets' `sources:` is literally an ordered YAML list **[V-doc]**). A `active: true` flag
   scattered across entries has two failure modes an ordered list cannot have — zero actives and two
   actives — and both are reachable by a text editor. **Order-only is the config-first choice, and
   the field's config-first products all made it.**
2. **No modes.** Etsy needs a Reorder mode; KDE only shows its checkboxes when the slideshow plugin is
   selected **[V]**. Our grid is one grid, always the same gestures, whatever the destination does
   with the list.
3. **One mechanism spans first-wins, dealt, and all-shown destinations.** The field needs three
   different models for those three (A, C, E). We need one list and a per-destination reading. For a
   single-owner homelab app where the same person will meet all three surfaces, one mental model is
   worth more than three locally-optimal ones — which is the D66 ruling restated as the field would
   argue it.

**Bottom line: the model is defensible and has real shipped precedent for every one of its parts. The
two things the field would tell us to add are copy, not controls** — a one-line statement of the rule
where the list lives (Jellyfin's help string is the template) and an unambiguous word for the winner
(we have it: the Active chip) — **plus one honest look at whether `promote` should exist everywhere,
because both products that made our choice concluded a phone needs it.**

---

## §5 — The numbers

```
PICARD default providers                4 rows, 3 enabled, 1 DISABLED IN PLACE at position 4    [V]
PICARD resolution rule                  "from top to bottom until an image is returned"         [V-doc]
BEETS default fetchart sources          5, ordered: filesystem coverart itunes amazon albumart  [V-doc]
BEETS cover_names (local file rank)     cover, front, art, album, folder                        [V-doc]
NAVIDROME coverartpriority default      5, ordered: cover.* folder.* front.* embedded external  [V]
NAVIDROME sibling priority chains       3 (cover / artist / disc), same syntax                  [V]
JELLYFIN image-fetcher row              1 checkbox + 1 move button, in one row                  [V]
JELLYFIN persistence                    ImageFetchers[] + ImageFetcherOrder[] — TWO parallel
                                        structures (the sibling-map shape our CLAUDE.md
                                        directive forbids; Picard's tuple list is the fix)      [V]
JELLYFIN remote-candidate page size     30 (6 on browser.slow)                                  [V]
KODI chooser entries                    Current + Embedded + N×Remote + Local + None + Browse   [V]
KDE slideshow "Order" options           5 sort modes, zero hand-ordering                        [V]
KDE per-image exclusion                 cfg_UncheckedSlides, tile keeps its position            [V]
SHOPIFY featured image                  position 1, no set-featured control on web              [V-doc]
SHOPIFY mobile app                      adds an explicit "Set as default"                       [V-doc]
ETSY listing thumbnail                  position 1; app has a Reorder mode + Save               [R]
OPEN-WEBUI background images stored     1  (string | null, one Upload/Reset button)             [V]
ORDER-ONLY PRIORITY over SOURCES        4 / 4 products read (Picard, beets, Navidrome, Jellyfin)
ORDER-ONLY PRIORITY over IMAGES         2 (Shopify, Etsy) — both add a phone affordance
ORDER + IN-PLACE MEMBERSHIP over IMAGES 0 — ctrl-b's combination is unprecedented as a whole
LIVE-WINNER MARK INSIDE A RANKING LIST  0 / 4 — ctrl-b's Active chip is ahead of the field
```

---

## §6 — The peer LLM-app class (brief, as briefed)

- **open-webui** — one setting, one slot: `let backgroundImageUrl: string | null = null;` with a
  single button whose label is `backgroundImageUrl !== null ? 'Reset' : 'Upload'`; saving writes
  `saveSettings({ backgroundImageUrl })`. Strings confirm the scope: `"Chat Background Image"`,
  `"Folder Background Image"`. **No library, no order, no membership, no history of prior
  backgrounds.** **[V]**
- **AnythingLLM** — *"You can replace the AnythingLLM branded logo that appears on the login page and
  throughout the app with your own brand's logo."* One logo. The doc says nothing about a reset
  control or a library. **[V-doc]**
- **LibreChat** — no in-app art management: the community answer is copying `client/public/assets` and
  rebuilding the React app (or docker-override mounts). Per-endpoint upload limits exist for user
  avatars only. **[R]**

**Reading:** the peer class has never had this problem, so it offers neither a pattern nor a
contradiction. ctrl-b is the only app in its own reference class with a per-destination art library
at all — which also means R59's and this dossier's evidence base must stay the media/OS/e-commerce
classes, and the peer-class rule in `docs/research/README.md` is legitimately relaxed here.

---

## §7 — What I could not determine

- **Whether any model-B ranking list anywhere marks the entry that actually won.** I verified the
  absence for Jellyfin (I read the row-rendering code) and Picard's list widget; beets and Navidrome
  have no UI to check. I did **not** exhaustively rule it out across the class. **[U]**
- **Whether Jellyfin clients treat backdrop `ImageIndex` 0 as the default backdrop.** The reorder
  mechanism is verified (`updateItemImageIndex`); the *consumption* rule is not. **[U]**
- **Plex's poster picker at first hand.** `support.plex.tv` 403s the fetcher; everything about the
  candidate carousel and the top-right check mark is **[R]**. The number of candidates Plex shows is
  unknown.
- **Etsy's photo grid at first hand** (403) — including the photo cap per listing and whether the app's
  Reorder mode has any per-photo action beyond dragging.
- **Emby** — not researched (assumed to track Jellyfin, its fork parent; not verified). **[U]**
- **Phone launchers / theming apps** (Nova, Lawnchair, KWGT icon-pack ordering) — named in the brief,
  **not researched**; budget went to the classes that were producing verdict-grade evidence. If the
  question ever becomes "ordered icon-pack fallback chains", that is where it lives.
- **Home Assistant picture cards** — R59 §2.7 already banked the verified negative (`ha-picture-upload`
  is a value-or-upload control with no library); not re-opened.
- **Any device/eyeball evidence.** This pass read source and docs; nothing was probed on a phone.
- **Whether the Radarr confusion generalises.** The "unchecked rows still rank" complaint is real and
  documented by third-party guides, but I found no usability study — the claim that mixed
  checked/unchecked ordered lists mislead is **[R]**, not measured.

---

## §8 — Implications for ctrl-b (ages fast; a proposal, not a decision)

1. **D66 stands on firmer ground than R59 implied.** Order-only priority is what every config-first
   art resolver in the field does, and it is the only shape a hand-edited YAML file cannot corrupt
   into "zero actives" or "two actives". R59's "0/6, no precedent" is *scoped to wallpaper pickers*;
   this dossier amends it there.
2. **Add the rule as copy, once, where the list lives** — Jellyfin's shipped line is the template.
   One sentence ("the first in-use image is the one shown") is what every model-B product ships
   instead of a control.
3. **Re-open `promote`'s scope — as choosing, not reordering.** Both products that ship our model over
   images added a phone-side "make this the one". We already have move-to-top; the field's argument is
   about **where it lives and what it is called**, not a second priority system (which D66 forbids,
   and this would not be — it is an order write).
4. **Keep the Active chip; treat it as load-bearing.** No model-B product has it, and it is the
   mitigation for the dimmed-row-above-the-winner state Radarr users demonstrably trip over.
5. **Do not adopt Jellyfin's storage.** `ImageFetchers[]` + `ImageFetcherOrder[]` is the
   parallel-sibling-map shape the 2026-06-24 directive forbids; **Picard's `[(name, enabled)]` is our
   `files: [{name, hidden}]`** and is the better precedent to cite in DECISIONS.

---

## §9 — Source index

**Source files read: see §1** (picard · jellyfin-web · navidrome · xbmc · plasma-workspace ·
open-webui, all at `master`/`main`, 2026-08-26).

**Docs [V-doc]:**

- MusicBrainz Picard — [Cover Art Options](https://picard-docs.musicbrainz.org/en/latest/config/options_cover.html).
- beets — [fetchart plugin](https://beets.readthedocs.io/en/stable/plugins/fetchart.html).
- Shopify Help Center — [Adding product media](https://help.shopify.com/en/manual/products/product-media/add-media).
- AnythingLLM — [Appearance Customization](https://docs.anythingllm.com/features/customization).

**Secondary [R]:** TRaSH Guides *How to set up Quality Profiles* + Servarr wiki (Radarr/Sonarr);
Plex Support *Edit Details* (403 — via search summaries and two how-to articles); Etsy Help *How to
Edit Your Listing Photos* (403 — same); Steam community guides (Set/Clear custom artwork); Wallpaper
Engine Steam discussions (playlist sorted vs random, "always start with first wallpaper").

**In-repo cross-references:** [R59](./R59-art-library-presentation.md) §0⑤, §6.1, §6.4, §11.4 (amended
here: "order-decides-active has no precedent" is scoped to the wallpaper/CMS class);
[R56](./R56-gallery-management-ux.md) §6; [R57](./R57-focal-point-crop-ux.md) §6.1 (the unified
per-item object);
[`docs/MEDIA_MANAGER_PLAN.md`](../MEDIA_MANAGER_PLAN.md) §2.2, §2.4, §6.5;
[`docs/DECISIONS.md`](../DECISIONS.md) D65, **D66**.
