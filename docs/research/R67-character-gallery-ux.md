# R67 — The character/agent GALLERY surface: list layout, selection model, transcript avatars, per-character voice

**Date: 2026-09-06.** Bounded single-agent field pass. Commissioned for `ROLEPLAY_PLAN.md` §8.4 (the
agent gallery as its own settings section) — the surface R66 did *not* buy. R66 §5 covered the
character **EDITOR forms**; this covers everything **around** them: the LIST/GALLERY, what tapping a
card does, whether a character's avatar appears beside chat messages, and whether a TTS voice binds
per character.

**Evidence only.** §11 maps findings onto ctrl-b seams; it rules nothing.

## Confidence key

- **[V]** verified — read the pinned source in the clone, file:line given.
- **[R]** reported — secondary/official docs, not source-read.
- **[U]** unverified — expected but not checked.

## Sources (pinned — the R64/R66 clones, SHAs re-verified 2026-09-06)

| Repo | SHA | Version / branch |
|---|---|---|
| SillyTavern/SillyTavern | `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8` | `release`, **1.18.0** |
| kwaroran/RisuAI | `c454df882aaf32e02a22da26d3718c8cadc97814` | HEAD 2026-09-05 |
| agnaistic/agnai | `fccee00f5f7628d150760c787c4be87e6b1a652c` | 2026-06-13 |

Docs-only **[R]**: `docs.openwebui.com/features/workspace/models/`,
`librechat.ai/docs/features/agents`, `librechat.ai/changelog/v0.8.0`.

ctrl-b internals cited below were read in-tree at the session HEAD (`728cd3d`).

⚠ The R64 search-pollution warning still applies: this topic's SEO surface is AI-generated content
farms. Everything below is repo, spec, or first-party docs.

---

## 1. The list/gallery surface, project by project

### 1.1 SillyTavern — a LIST by default, with a grid toggle that strips the card to nothing **[V]**

The character panel is a fixed toolbar over a paginated block:

```
public/index.html:6353-6377   (rm_button_bar)
  rm_button_create           "Create New Character"       fa-user-plus
  character_import_button    "Import Character from File" fa-file-import
  external_import_button     "Import content from external URL"
  rm_button_group_chats      "Create New Chat Group"
  rm_buttons_container       <!-- Container for additional buttons added by extensions -->
  character_sort_order       <select> …
  rm_button_search           "Toggle search bar"
```

The card template (`public/index.html:7220-7239`) is a **row**, not a tile:

```html
<div class="character_select entity_block flex-container wide100p alignitemsflexstart" chid="" id="">
    <div class="avatar" title=""><img src=""></div>
    <div class="flex-container wide100pLess70px character_select_container">
        <div class="wide100p character_name_block">
            <span class="ch_name"></span>
            <small class="ch_additional_info ch_add_placeholder">+++</small>
            <small class="ch_assistant" …><i class="fa-solid fa-sm fa-user-graduate"></i></small>
            <small class="ch_additional_info character_version"></small>
            <small class="ch_additional_info ch_avatar_url"></small>
        </div>
        <i class="ch_fav_icon fa-solid fa-star"></i>
        <input class="ch_fav" value="" hidden />
        <div class="ch_description"></div>
        <div class="tags tags_inline"></div>
    </div>
</div>
```

**What text actually rides it** (`public/script.js:937-980`, `getCharacterBlock`) — note the
description is *not* the card's `description` field:

```js
const description = item.data?.creator_notes || '';
…
const auxFieldName = power_user.aux_field || 'character_version';
const auxFieldValue = (item.data && item.data[auxFieldName]) || '';
```

The aux field is owner-configurable; its settings tooltip reads *"If set in the advanced character
definitions, this field will be displayed in the characters list."* (`public/index.html:5160`).

**Grid mode is opt-in and lossy.** `power_user.charListGrid: false` is the default
(`public/scripts/power-user.js:117`); the toggle is one icon in the pagination bar
(`public/index.html:6390`, title *"Toggle character grid view"*) and flips a body class
(`public/script.js:10737-10738`). The CSS (`public/css/toggle-dependent.css:62-160`):

```css
body.charListGrid #rm_print_characters_block {
    display: flex;  gap: 5px;  flex-wrap: wrap;  flex-direction: row;
    justify-content: space-around;  align-content: flex-start;
}
body.charListGrid #rm_print_characters_block .character_select, … {
    width: 30%;  align-items: flex-start;  height: min-content;
    flex-direction: column;  overflow: hidden;  max-width: 100px;
}
body.charListGrid … .ch_description,
body.charListGrid … .tags_inline,
body.charListGrid … .ch_avatar_url,
body.charListGrid … .character_version, … { display: none; }
```

So ST's "grid" is **avatar + centred name at `font-size: calc(var(--mainFontSize) * .8)`, capped at
100 px wide** — every other card field is hidden. It is a density mode, not a richer card.

**Avatar geometry — the 2:3 question, answered in three places [V]:**

| Where | Value | Source |
|---|---|---|
| Server-canonical card image | **512 × 768 = 2:3** | `src/constants.js:358-359` `export const AVATAR_WIDTH = 512; export const AVATAR_HEIGHT = 768;` |
| …but only on request | `if (crop.want_resize) { finalWidth = AVATAR_WIDTH; finalHeight = AVATAR_HEIGHT; }` | `src/endpoints/characters.js:296-297` |
| Default rendered avatar | **50 × 50, circular** | `public/style.css:122-126` `--avatar-base-height: 50px; --avatar-base-width: 50px; --avatar-base-border-radius-round: 50%` + `avatar_style: avatar_styles.ROUND` (`power-user.js:141`) |
| "Rectangular" avatar mode | **60 × 90 = 2:3** | `public/css/toggle-dependent.css:2-4` `--big-avatar-height-factor: 1.8; --big-avatar-width-factor: 1.2;` × the 50 px base |

`avatar_styles = { ROUND: 0, RECTANGULAR: 1, SQUARE: 2, ROUNDED: 3 }` (`power-user.js:95-100`) — a
global four-way appearance setting, not per character.

**Paging, not virtualization** (`public/script.js:551`, `991-1075`):

```js
const per_page_default = 50;
…
const sizeChangerOptions = [10, 25, 50, 100, 250, 500, 1000];
$('#rm_print_characters_pagination').pagination({
    dataSource: entities, pageSize, pageRange: 1, position: 'top',
    showPageNumbers: false, showSizeChanger: true, …
```

The callback `$(listId).empty()` then appends one cloned template per entity — a full re-render of the
page, with the scroll position restored in `afterRender`. Page size persists in `accountStorage`
under `'Characters_PerPage'`. No windowing library anywhere.

### 1.2 RisuAI — a Discord-style 80 px RAIL, plus a four-mode catalog **[V]**

Risu's **primary** surface is not a gallery at all: `src/lib/SideBars/Sidebar.svelte:400` is

```html
class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
```

— an 80 px vertical rail of 56 px avatars (`SidebarAvatar … size="56"`, `Sidebar.svelte:593-597`),
with an active-item indicator, **drag-to-reorder**, and **folders** you drag characters into
(`Sidebar.svelte:100-247`; folder rename/colour/image via `oncontextmenu` → `alertSelect`, 604-620).

The avatar itself (`src/lib/SideBars/SidebarAvatar.svelte:100-108`):

```html
<img src={img}
  class="bg-skin-border sidebar-avatar rounded-md object-cover object-top"
  style:width={size + "px"} style:height={size + "px"} style:minWidth={size + "px"}
  class:rounded-md={!rounded} class:rounded-full={rounded} alt="avatar" />
```

**`object-top`** — a square avatar crops from the TOP of the source image, the field's cheapest
face-preserving heuristic. `rounded` is a global (`IconRounded`) flipping square↔circle.

The dedicated browse surface is `src/lib/Others/GridCatalog.svelte` — **four view modes behind
buttons**, `selected = 3` on open (line 21):

| mode | line | what it shows |
|---|---|---|
| `3` **Simple** (default) | 159-161 | delegates to `MobileCharacters` (the row list, §6) |
| `0` **Grid** | 90-109 | `<div class="flex flex-wrap gap-2 w-full justify-center">` of bare 56 px `BarIcon`s — **no name, no text at all** |
| `1` **List** | 110-131 | avatar + `<h4>` name + `creatorNotes` + open/delete icon buttons |
| `2` **Trash** | 132-158 | soft-deleted characters (`trashTime`), restore ↺ or permanent delete |

The whole catalog is width-capped: `class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col
overflow-y-auto"` (line 57) — 672 px, centred, so it never sprawls on a wide screen. It carries a
live count:

```html
<span class="text-textcolor2 text-sm">
    {formatChars(search, DBState.db).length} {language.character}
</span>
```

Description fallback is literal: `desc: c.creatorNotes ?? 'No description'` (line 47).

**No pagination and no virtualization** in any Risu view; `formatChars(search, DBState.db)` is called
inside the template *twice* per render (the count at line 86, the loop at line 93), so the whole
library is filtered and rebuilt on each reactive tick.

### 1.3 Agnaistic — three views, persisted, with real cards **[V]**

`web/pages/Character/CharacterList.tsx` is the closest thing in the field to what §8.4 describes.

**View + sort are persisted to localStorage** (`CACHE_KEY = 'agnai-charlist-cache'`, line 46), and the
default is the LIST, not the cards (line 596):

```ts
const defaultCache: ListCache = { sort: { field: 'modified', direction: 'desc' }, view: 'list' }
```

Sort is a real dropdown plus an asc/desc button (lines 55-60):

```ts
const sortOptions: Option<SortField>[] = [
  { value: 'modified', label: 'Last Modified' },
  { value: 'conversed', label: 'Last Conversed' },
  { value: 'created', label: 'Created' },
  { value: 'name', label: 'Name' },
]
```

Toolbar: `Import` · `Create` · `Select` (multi-select mode) · refresh; then a `Search by name...`
input, the sort pair, a `<TagSelect />`, and a view-cycle button on the right (lines 275-348).

**The card** (`web/pages/Character/components/CharacterCardView.tsx`):

```html
<div class="grid w-full grid-cols-[repeat(auto-fit,minmax(160px,1fr))] flex-row flex-wrap justify-start gap-2 py-2">
```
```html
<A href={…} class="block h-32 w-full justify-center overflow-hidden rounded-lg rounded-b-none">
  <img src={getAssetUrl(props.char.avatar!)}
       class="h-full w-full object-cover"
       style="object-position: 50% 30%;" />
</A>
```

— a 160 px-minimum auto-fit grid; a **128 px fixed image band** (so the card is not a 2:3 portrait;
the source is cropped into a landscape-ish band) with the crop biased **upward to 30 %**, the same
face heuristic Risu spells `object-top`. Under it (lines 101-131): the name (`overflow-hidden
text-ellipsis whitespace-nowrap … text-center font-bold`), then the description clamped to a fixed
box —

```html
<div class="text-600 line-clamp-3 h-[3rem] text-ellipsis px-1 text-center text-xs font-normal">
  {props.char.description}
</div>
```

— then a footer row of favourite-star · `toDuration(new Date(props.char.chat.updatedAt)) + ' ago'` ·
an arrow that opens the recent chat (or the chat list if there is none). A download button and a
hamburger `DropMenu` are floated **over** the image (lines 156-180, with the comment *"hacky
positioning shenanigans are necessary as opposed to using an absolute positioning because if any of
the DropMenu parent is positioned, then DropMenu breaks…"*).

**Favourites are a GROUP, not a sort key** (lines 445-456): the renderer builds
`[{ label: 'Favorites', list: props.favorites }, { label: '', list: props.characters }]` and drops the
first group when empty — so favourites render as a labelled band above the rest, in every view.

**Paging**: `usePagination({ … pageSize: 50 })` (lines 141-144) with `<ManualPaginate>` rendered both
above and below the grid, and both hidden in folder view. No virtualization.

### 1.4 open-webui and LibreChat — the assistant-app contrast **[R, docs only]**

**open-webui, Workspace › Models.** A **list** of rows, each with an *Enabled* switch and a `...`
menu offering *Edit · Hide · Clone · Copy Link · Export · Share · Delete*. Organization is a
`Search Models` field plus a view dropdown (documented as *"the **All** dropdown next to
**Actions**"*) with *Selected / Pinned / Enabled / Disabled / Visible / Hidden / Public / Private*.
Manual drag-to-reorder is available *"only with no search text and no filter applied"*. `Create` sits
in the Workspace header; import/export is `.json`, plus a **Discover** community section at the page
bottom. Avatar guidance is one line: *"Animated GIF and WebP are supported"* — no size or aspect
stated.

**LibreChat.** The agents docs describe **no gallery**: *"Existing agents can be selected from the top
dropdown of the Side Panel"*, or `@`-mentioned in chat. v0.8.0's changelog adds an *"Agent marketplace
ecosystem for discovering and sharing agents with categorization, promotion system, advanced sharing
dialogs with role-based access controls, and people picker UI for user/group/role search."* — the
existence of categories and search is stated; the layout is not documented anywhere I could reach.
**This is a gap, not a finding** (§10).

---

## 2. Organization at scale — the shipped feature set **[V]**

| | ST 1.18.0 | RisuAI | Agnai |
|---|---|---|---|
| Search | toggleable bar, `#character_search_bar`; adds a hidden `Search` sort option while active (`script.js:1081-1090`) | always-on; normalized `value.replace(/ /g,"").toLocaleLowerCase()` (`MobileCharacters.svelte:20-22`) | `Search by name...`, plain substring |
| Sort options | **11** — A-Z, Z-A, Newest, Oldest, Favorites, Recent, Most chats, Least chats, Most tokens, Least tokens, Random (`index.html:6361-6373`) | none exposed; fixed `lastInteraction` desc, name tiebreak (`MobileCharacters.svelte:65-70`) | 4 + direction toggle |
| Tags | first-class; `printTagFilters(tag_filter_type.character)` + inline tag chips on every card | none | `<TagSelect />`; `tagStore.updateTags(chars.list)` derives the tag set from the library |
| Favourites | `ch_fav` per card + a `Favorites` sort + **Hotswap**: *"In the Character Management panel, show quick selection buttons for favorited characters."* (`index.html:5134`) | none | a rendered GROUP above the list, in all three views |
| Folders | **tags AS folders**: `bogus_folders`, *"Show tagged character folders in the character list."* with the note *"Tags must be marked as folders in the Tag Management menu to appear as such."* (`index.html:5143-5147`) | real folders, drag-in, per-folder name/colour/image | a third `folders` view (`CharacterFolderView`) |
| Bulk ops | long-press → bulk-select; Favorite/Tag/Duplicate/Persona/Delete | — | `Select` mode → Delete · Archive · Unarchive · Download · Done |
| Soft delete | — | **Trash** view with restore (`trashTime`) | Archive / Unarchive |
| Paging | 50/page, changer `[10,25,50,100,250,500,1000]` | none | 50/page, `ManualPaginate` top+bottom |
| Virtualization | **none** | **none** | **none** |

**3/3 ship paging or nothing; 0/3 virtualize.** For a library of a few dozen characters, none of the
three found windowing worth its cost.

---

## 3. The selection model — what a tap actually does **[V]**

**SillyTavern: first tap opens the CHAT, a second tap on the same card opens the EDITOR.** One
handler, one function (`public/script.js:11132-11135`):

```js
$(document).on('click', '.character_select', async function () {
    const id = Number($(this).attr('data-chid'));
    await selectCharacterById(id);
});
```

and `selectCharacterById` (`public/script.js:873-906`, doc comment at 862-872) branches on whether it
is already selected:

```js
if (selected_group || String(this_chid) !== String(id)) {
    //if clicked on a different character from what was currently selected
    if (!is_send_press) {
        setCharacterId(undefined); … await clearChat({ clearData: true }); cancelTtsPlay();
        this_edit_mes_id = undefined;
        selected_button = 'character_edit';
        setCharacterId(id); chat_metadata = {}; await getChat();
    }
} else {
    //if clicked on character that was already selected
    switchMenu && (selected_button = 'character_edit');
    await unshallowCharacter(this_chid);
    select_selected_character(this_chid, { switchMenu });
}
```

Editing is otherwise unreachable from the card; there is no per-card menu. The long-press instead
enters **bulk mode** (`public/scripts/BulkEditOverlay.js:389`, `565-600`):

```js
static longPressDelay = 2500;
…
if (this.state === BulkEditOverlayState.browse) {  this.selectState();  }
else if (this.state === BulkEditOverlayState.select) {  … CharacterContextMenu.show(x, y);  }
```

i.e. **long-press once = select mode, long-press again = the context menu** (Favorite · Tag ·
Duplicate · Persona · Delete, `public/index.html:56-60`) — 2.5 s is unusually long for a touch idiom.

**RisuAI: a tap is unambiguously "switch to this character".** Every surface calls the same
`changeChar(index)` — the rail (`Sidebar.svelte:580-583`), the mobile row
(`MobileCharacters.svelte:76-79`), and all three catalog modes. Editing is a separate mode: the
sidebar's own `Chat` / `character` tab pair (`Sidebar.svelte:954-963`) switches the right pane
between the conversation and `CharConfig`. Right-click is reserved for **folders**, not characters.

**Agnai: the card is a set of distinct links, and Edit is a MODAL over the list.** The image and
name link to `/chat/{chat._id}` when a recent chat exists and `/character/{id}/chats` otherwise
(`CharacterCardView.tsx:76-89`); the trailing arrow does the same explicitly. The hamburger menu
(lines 192-238) carries **New Chat · Edit · Favorite · Chat List · Duplicate · Delete**, and `Edit`
raises `<EditCharacter char={editChar()} close={…} />` over the list rather than navigating
(`CharacterList.tsx:533`) — so the list is never lost.

**Summary of the split:** all three make the *primary* tap "talk to this character"; they differ only
in how editing is reached — a second tap (ST), a mode switch (Risu), or a per-card menu item that
opens a modal (Agnai). None makes editing the primary gesture.

---

## 4. Creation and import entry points **[V]**

- **ST**: four icon buttons pinned at the top of the list — create, import-from-file,
  import-from-URL, new group (`index.html:6353-6357`). The file input accepts
  `accept=".json, image/png, .yaml, .yml, .charx, .byaf"` (`index.html:6349`) and is `multiple`.
- **Risu**: a floating action button — `class="p-4 rounded-full absolute bottom-2 right-2 bg-borderc"`
  with a `PlusIcon` (`MobileCharacters.svelte:95-99`) → `addCharacter()`. Import lives in the
  hamburger menu, not on the list.
- **Agnai**: `Import` and `Create` are the first two buttons of the page subtitle, and their **labels
  vanish on phones** — `<Button size="sm" onClick={() => setImport(true)}><Import /><span class="hidden
  sm:inline">Import</span></Button>` (line 276-279). `Create` navigates to `/character/create`;
  `Import` raises `<ImportCharacterModal>` with a `charhubPath` prop (a deep-link import from an
  external catalog).

---

## 5. Empty states and fresh-install defaults **[V]**

**ST rotates a joke** (`public/script.js:914-923`):

```js
const icons = ['fa-dragon', 'fa-otter', 'fa-kiwi-bird', 'fa-crow', 'fa-frog'];
const texts = [t`Here be dragons`, t`Otterly empty`, t`Kiwibunga`, t`Pump-a-Rum`, t`Croak it`];
const roll = new Date().getMinutes() % icons.length;
```

rendered through `emptyBlock.html`: a `fa-4x` icon, the rolled `<h1>`, and a fixed
`<p>There are no items to display.</p>`. A **separate** block reports filtered-out cards:
`t\`${hidden} characters hidden.\`` (`script.js:929-935`) — shown only when a filter is active, so
"nothing matches" and "nothing exists" are visually different states.

**But a fresh ST install is not empty**: `default/content/default_Seraphina.png` ships one character,
seeded on first run. There is also a `ch_assistant` badge on the card of whichever character is the
welcome-page assistant (*"This character will be used as a welcome page assistant."*,
`index.html:7228`).

**Risu**'s empty right pane reads *"Welcome to RisuAI!"* / *"Select a bot to start chatting"*
(`Sidebar.svelte:932-933`) — the empty state is on the *conversation* side, not the list.

**Agnai** puts the next action inside the sentence (`CharacterList.tsx:609-616`):

```html
<div class="mt-16 flex w-full justify-center rounded-full text-xl">
  No characters found&nbsp;<A class="text-[var(--hl-500)]" href="/character/create">Create a character</A>&nbsp;to get started!
</div>
```

It also distinguishes **loading** from **empty** with an explicit `<Match when={props.loading &&
props.allCharacters.length === 0}><Loading /></Match>` ahead of the empty match (lines 471-481), and
falls back to *"Failed to load characters. Refresh to try again."*

---

## 6. Mobile behaviour **[V]**

**Agnai deletes a view mode on phones.** `CharacterList.tsx:163-170`:

```ts
const mobile = isMobile()

const getNextView = (): ViewType => {
  const curr = view()
  if (!mobile) {
    return curr === 'list' ? 'cards' : curr === 'cards' ? 'folders' : 'list'
  }

  return curr === 'list' ? 'cards' : 'list'
}
```

— the folder view is simply not in the phone's cycle. Button labels also collapse to icons
(`hidden sm:inline`), and the card grid's `auto-fit,minmax(160px,1fr)` naturally lands on 2 columns at
360 px.

**Risu ships a dedicated mobile component**, and it is a ROW LIST, not a grid
(`src/lib/Mobile/MobileCharacters.svelte:73-93`):

```html
<div class="flex flex-col items-center w-full overflow-y-auto h-full">
  {#each sortChar(DBState.db.characters) as char, i}
    {#if normalizeSearch(char.name).includes(normalizedSearch)}
      <button class="flex p-2 border-t-darkborderc gap-2 w-full" class:border-t={i !== 0} onclick={() => { changeChar(char.i); endGrid() }}>
        <BarIcon additionalStyle={getCharImage(char.image, 'css')}></BarIcon>
        <div class="flex flex-1 w-full flex-col justify-start items-start text-start">
          <span>{char.name}</span>
          <div class="text-sm text-textcolor2 flex items-center w-full flex-wrap">
            <span class="mr-1">{char.chats}</span>
            <MessageSquareIcon size={14} />
            <span class="mr-1 ml-1">|</span>
            <span>{char.agoText}</span>
          </div>
        </div>
      </button>
    {/if}
  {/each}
</div>
```

Two facts worth lifting: the secondary line is **chat count + a relative "ago"** built with
`Intl.RelativeTimeFormat(navigator.languages, { style: 'short' })` (line 15, ladder at 24-51), and
Risu considered this row list good enough that the desktop catalog's **default** mode just embeds it
(§1.2).

**ST** has a `mobile-styles.css`, but it contains **no** character-list rules — the list is the same
flex column at every width, and the grid toggle's `width: 30%; max-width: 100px` is the only density
lever.

---

## 7. Character avatars in the CHAT transcript **[V]**

**3/3 show them, on both sides, and 3/3 let you turn them off — but at three different scopes.**

**SillyTavern** puts an avatar in every message (`public/index.html:7381-7388`):

```html
<div class="mesAvatarWrapper">
    <div class="avatar"><img src=""></div>
    <div class="mesIDDisplay"></div>
    <div class="mes_timer"></div>
    <div class="tokenCounterDisplay"></div>
</div>
```

The user's persona avatar renders in the same slot on user messages; in group chats each member's own
avatar rides its own message (the `.mes .avatar` is populated per message, and group cards get a
`avatar_collage` variant). It is hidden **as a consequence of a chat STYLE**, not by its own toggle —
`Chat Style: Flat | Bubbles | Document` (`index.html:4953-4957`), and
(`public/css/toggle-dependent.css:354-360`):

```css
body.documentstyle #chat .mes .mesAvatarWrapper,
body.documentstyle #chat .mes .mes_block .ch_name .name_text,
body.documentstyle #chat .mes .mes_block .ch_name .timestamp, … {
    display: none !important;
}
```

Document mode drops the avatar, the name, and the timestamp together — the whole speaker
apparatus — leaving prose. Shape follows the same global `avatar_style` as the list (§1.1), so
rectangular mode makes the transcript avatars 2:3 cards too. `.mes .avatar { cursor: pointer }` and
tapping opens a zoomed avatar panel (with an optional *"Avatar Hover Magnification"*,
`index.html:5138-5142`).

**RisuAI has the finest-grained model of the three, and two of its three knobs are per character:**

| knob | scope | source |
|---|---|---|
| `hideChatIcon` | **per character** | `src/ts/process/modules.ts:577` `HideIconStore.set(getCurrentCharacter()?.hideChatIcon \|\| moduleHideIcon)` |
| `largePortrait` | **per character** *and* per persona | `database.svelte.ts:1462` (character) and `:796` (`RisuPersona`) |
| `iconsize` (%) / `roundIcons` | global | `database.svelte.ts:845`, `:890`; default `data.iconsize = 100` (`:136-137`) |

The render (`src/lib/ChatScreens/Chat.svelte:968-993`, the `senderIcon` snippet) — base size is
`iconsize × 3.5/100` rem, i.e. **56 px at the default 100 %**, matching the sidebar avatar exactly:

```svelte
{#if largePortrait && (!options?.rounded)}
    <div class="shadow-lg bg-textcolor2" style={m + (options?.styleFix ?? `height:${DBState.db.iconsize * 3.5 / 100 / 0.75}rem;width:${DBState.db.iconsize * 3.5 / 100}rem;…`)}
```

`height = width / 0.75` ⇒ a **3:4 portrait** in the transcript, and `largePortrait` is explicitly
incompatible with round icons (`&& (!options?.rounded)`). The persona side picks its own
(`Chats.svelte:96`):

```ts
const messageLargePortrait = message.role === 'user' ? (userIconPortrait ?? false) : ((currentCharacter as character).largePortrait ?? false);
```

**Agnai makes the avatar a UI setting with a `hide` value, and reuses the slot as a TTS transport.**
`common/types/ui.ts:18-30`:

```ts
export const AVATAR_SIZES = ['hide','xs','sm','md','lg','xl','2xl','3xl','max3xl','custom'] as const
export const AVATAR_CORNERS = ['sm','md','lg','circle','none'] as const
```

with `avatarSize: 'md', avatarCorners: 'circle'` as defaults (`:161-162`), plus custom width/height
sliders. A detail that decides aspect handling — in `web/shared/avatar.css`, **only the
`.avatar-circle` variants set a height**:

```css
.avatar-md      { @apply w-8 min-w-[2rem] overflow-hidden sm:w-10 sm:min-w-[2.5rem]; }
.avatar-md.avatar-circle { @apply h-8 min-h-[2rem] sm:h-10 sm:min-h-[2.5rem]; }
```

so a non-circle avatar is width-constrained and **keeps the source image's own aspect** — a 2:3 card
renders as a tall rectangle beside the bubble with no extra code. Note also that every size halves on
phones (`w-8` → `sm:w-10`): the responsive step is baked into the size token, not into a media query
at the call site.

The slot itself (`web/pages/Chat/components/Message.tsx:365-405`) is `float-left pr-3` (text wraps
around it when `imageWrap` is on) and switches by state:

```tsx
<Match when={user.ui.avatarSize === 'hide'}>{null}</Match>
<Match when={msg().event === 'world' || msg().event === 'ooc'}>… <Zap /> …</Match>
<Match when={props.voice === 'generating'}>
  <div class="animate-pulse cursor-pointer" onClick={responseStore.stopSpeech}>
    <AvatarIcon format={format()} Icon={DownloadCloud} />
```

— during TTS synthesis the avatar becomes a pulsing download glyph, during playback a pulsing
`PauseCircle`, both clicking through to `stopSpeech`. **The avatar slot is the speech transport.**

---

## 8. Per-character TTS voice binding **[V]**

**3/3 bind a voice per character. Two of the three put it ON the character; ST alone keeps a
name-keyed map in settings.**

### 8.1 SillyTavern — a name-keyed map, stored per TTS PROVIDER

`public/scripts/extensions/tts/index.js:46-47`:

```js
let voiceMapEntries = [];
let voiceMap = {}; // {charName:voiceid, charName2:voiceid2}
```

It is persisted into extension settings, keyed by the active provider (`updateVoiceMap`, ~1369-1390):

```js
if (!extension_settings.tts[ttsProviderName].voiceMap) {
    extension_settings.tts[ttsProviderName].voiceMap = {};
}
Object.assign(extension_settings.tts[ttsProviderName].voiceMap, voiceMap);
```

Two reserved keys carry the policy (`:55-56`):

```js
const DEFAULT_VOICE_MARKER = '[Default Voice]';
const DISABLED_VOICE_MARKER = 'disabled';
```

Resolution is a one-hop indirection — an entry equal to the default marker re-reads the default
entry (`:186-188`, `:636`) — and **an unmapped character is an error, not a fallback** (`:648-650`):

```js
if (!voiceMapEntry) {
    throw `${char} not in voicemap. Configure character in extension settings voice map`;
}
```

which surfaces as `toastr.error(error.toString())`. The manual `/speak` path is gentler:
`toastr.info(\`Specified voice for ${name} was not found. Check the TTS extension settings.\`)`
(`:197`). A `disabled` entry warns **once** per character via `accountStorage`
(`tts_disabled_warned_${char}`, `:629-634`) rather than on every message.

The rows offered are chat-scoped: single chat = `[Default Voice]` + `context.name1` (the user) +
`context.name2` (the character); group chat = `[Default Voice]` + the user + every group member
(`getCharacters`, `:1297-1323`). With `multi_voice_enabled` each character expands into three
sub-keys (`:1327-1340`):

```js
expandedCharacters.push(`${char} ("Quotes")`);
expandedCharacters.push(`${char} (*Text inside asterisks*)`);
expandedCharacters.push(`${char} (Other text)`);
```

so dialogue, action and narration can each take a different voice.

### 8.2 RisuAI — the whole TTS stack lives on the character object

`src/ts/storage/database.svelte.ts` (the `character` interface): `ttsMode?: string` (`:1387`),
`ttsSpeech`, `ttsReadOnlyQuoted?: boolean` (`:1434`), `oaiVoice?: string` (`:1442`), plus complete
per-character provider configs — `oaiTTSConfig` (`:1442-1457`), `gptSoVitsConfig` (`:1401-1421`),
`fishSpeechConfig` (`:1422-1430`), `hfTTS`, `vits`. The `oaiTTSConfig` doc comments are the sharpest
statement of the model:

```ts
/** User opted into advanced OpenAI-compatible settings. When false/absent,
 *  tts.ts ignores the other fields and uses the legacy oaiVoice + db.openAIKey path. */
enabled?: boolean
/** Base URL, trailing slash trimmed at runtime. Falls back to 'https://api.openai.com/v1'. */
baseURL?: string
/** Per-character API key. Falls back to db.openAIKey; the Authorization header is omitted entirely when both are empty. */
apiKey?: string
/** Model ID. Falls back to 'tts-1'. */
model?: string
/** Freeform voice ID for custom endpoints. Falls back to character.oaiVoice, then to 'alloy'. */
voice?: string
```

— a per-character **endpoint, key, model and voice**, each with a documented fallback ladder to the
global. Dispatch is `switch(character.ttsMode)` (`src/ts/process/tts.ts:116`) over nine cases
(`webspeech · elevenlab · VOICEVOX · openai · novelai · huggingface · vits · gptsovits · fishspeech`)
with **no `default:` branch** — a character with no `ttsMode` is a silent no-op. There is no global
"voice for everyone".

### 8.3 Agnaistic — one optional field on the character, a tagged union

`common/types/library.ts:44-45`:

```ts
  voice?: VoiceSettings
  voiceDisabled?: boolean
```

`common/types/texttospeech-schema.ts:10-49` — a union discriminated by `service`, with the *absence*
of a service as its own explicit member:

```ts
export type VoiceSettings =
  | VoiceDisabledSettings | VoiceElevenLabsSettings | VoiceWebSynthesisSettings
  | NovelTtsSettings | AgnaiTtsSettings

export type VoiceDisabledSettings = { service: undefined;  rate?: number }
export type VoiceElevenLabsSettings = {
  service: 'elevenlabs';  voiceId: string;  model?: ElevenLabsModel
  stability?: number;  similarityBoost?: number;  rate?: number
}
```

Resolution is three guards, unmapped = silent (`web/store/message.ts:750-757`):

```ts
function getMessageSpeechInfo(msg: AppSchema.ChatMessage, user: AppSchema.User | undefined) {
  if (msg.adapter === 'image' || !msg.characterId || msg.userId) return
  …
  if (!char?.voice) return
  if (!user?.texttospeech?.enabled) return
  if (char.voiceDisabled) return
```

— a **global master gate** (`user.texttospeech.enabled`, alongside `filterActions`) over a
**per-character binding**, with a separate per-character mute. The editor gives it a whole tab
(`web/pages/Character/CreateCharacterForm.tsx:609-625`):

```tsx
<div class="flex flex-col gap-2" classList={{ hidden: tabs.current() !== 'Voice' }}>
  <Card class="flex flex-col gap-3">
    <h4 class="text-md font-bold">Voice</h4>
    <Toggle fieldName="voiceDisabled" … label="Disable Character's Voice"
            helperText="Toggle on to disable this character from automatically speaking" … />
    <VoicePicker value={editor.state.voice} culture={editor.state.culture} onChange={…} />
```

with the picker split into `VoiceServiceSelect` → `VoiceIdSelect` → per-service settings +
`VoicePreviewButton` (`web/pages/Character/components/VoicePicker/`). Note `culture` is passed into
the picker — the character's language narrows the offered voices.

### 8.4 The comparison that matters

| | binding lives | key | unmapped character | global default |
|---|---|---|---|---|
| ST | `extension_settings.tts[provider].voiceMap` | **character NAME** | throws → `toastr.error` | `'[Default Voice]'` entry |
| Risu | the character object | character id | **silent no-op** | none |
| Agnai | the character object (`voice?`) | character id | **silent no-op** | none (only a master on/off) |

ST's is the only design keyed by a mutable display name and the only one scoped per provider — so
renaming a character, or switching TTS providers, drops its voice. Both object-based designs treat
"no voice" as "this character does not speak", and neither invents a fallback voice.

---

## 9. Corrections to premises

1. **"ST's 2:3 avatar aspect" is true of the FILE and of an opt-in mode, not of what you see.**
   `AVATAR_WIDTH/HEIGHT = 512/768` is the server-side canonical card, applied only when the crop
   dialog requests a resize; the **default rendered avatar is a 50 × 50 circle** everywhere
   (`avatar_style: ROUND`). 2:3 appears only under `avatar_style: RECTANGULAR` (60 × 90). Designing
   "to ST's 2:3" without saying which of the three you mean will produce the wrong card.
2. **"Grid vs list — which is the gallery?" — none of the three defaults to a grid.** ST
   `charListGrid: false`; Agnai `view: 'list'`; Risu's catalog opens on `selected = 3`, the row list.
   The visual grid is universally the opt-in density mode, and in ST it *removes* information
   (description, tags, version, file name all `display: none`).
3. **The premise that a gallery card is a portrait card is wrong for 2/3.** Agnai's card image is a
   fixed **128 px landscape band** cropped at `object-position: 50% 30%`; Risu's grid cell is a bare
   56 px square. Portrait aspect shows up in the **transcript** (Risu `largePortrait` = 3:4; ST
   `big-avatars` = 2:3), not in the list.
4. **"Is a per-character TTS voice a v1 field or a seam?" — the field answers 3/3 YES, and 2/3 put it
   on the character.** The relevant nuance is not *whether* but *where*: ST's name-keyed settings map
   is the design that ages badly (rename-fragile, provider-scoped), and it is also the oldest.
5. **LibreChat's public docs do not describe an agents gallery at all**, despite v0.8.0 shipping a
   marketplace. The reference-class contrast I was asked for is therefore thin on the LibreChat side
   and rests on a one-sentence changelog line.
6. **Long-press is not a shortcut to a context menu in ST** — it is a two-stage escalation into bulk
   mode, at a 2500 ms threshold. If ctrl-b's gallery wants a per-card menu on touch, ST is not the
   precedent to copy; Agnai's always-visible hamburger is.

---

## 10. Known gaps

- **open-webui and LibreChat were not source-read** — both entries in §1.4 are `[R]` from official
  docs. LibreChat's marketplace UI in particular is undocumented; reading `client/src/components/`
  in the LibreChat repo would settle it and was out of budget here.
- **Q4 (measured/stated design rationale) is essentially unbought.** No issue archaeology was run.
  What exists in-repo is settings help text (`Tags as Folders`, `Characters Hotswap`, the aux-field
  tooltip) and the Agnai `DropMenu` positioning comment, both quoted above. ST's docs clone in the
  research cache holds only `worldinfo.md`, so the docs angle was unavailable.
- **No performance numbers.** "0/3 virtualize" is a code fact; nobody measured a 500-character
  library on a phone, and Risu's per-render `formatChars` re-filter is an observation, not a
  measurement.
- **Risu's "Realm"** (its online character store / import surface) was not examined; it may carry a
  richer browse grammar than the local catalog.
- **ST's `.byaf` container** appears in the import accept list and is not covered by R66.
- **Group-chat avatar differentiation** was confirmed structurally in ST (per-message avatar,
  `avatar_collage` for the group entity) but the group-member rendering path was not read line by
  line **[U]**.

---

## 11. Implications for ctrl-b — seams only, no decisions

*(Evidence above ages slowly; this reading ages fast. Nothing here is a design ruling —
`ROLEPLAY_PLAN.md` §8.4 and the council own those.)*

**① The gallery section.** The navigation seam is `frontend/src/hooks/useSections.ts` +
`theme-engine/tabs.tsFor(theme)` — a new section is a registry entry, and `partitionSections` already
decides bar-vs-menu placement per layout, so a gallery section needs no new nav concept. What it
replaces is `frontend/src/components/AgentsEditor.tsx:437-470`: today each agent is a `.mwrap` +
`.confrow` disclosure (title · `agent-slug` · one-line desc · `badge` · chevron) with the full form
inline — i.e. ctrl-b currently ships the *list* half of ST's model with the editor grafted into it,
and no avatar anywhere.

**② The in-house card-grid precedent is gacha, and it is already close to Agnai's shape.**
`frontend/src/themes/gacha/gacha.css:1256-1312` is a fixed 2-column `.gc-track`
(`grid-template-columns: 1fr 1fr`, `gap: calc(14px + var(--gc-lift))`) of `aspect-ratio: 3/4` cards,
with `feat` (5:4) and `wide` (16:9) cards spanning `grid-column: 1/-1`.
`GachaCard.tsx` is the card: button-is-the-slot, `FocalImg src={art.url} art={art.focus}` inside a
masked face, a `.plate` carrying `<b>{host.name}</b><small>{plateSub(host)}</small>`. That
name-over-sub plate is structurally Agnai's name + clamped description. **`FocalImg` + `art.focus`
is also ctrl-b's answer to the `object-top` / `object-position: 50% 30%` heuristic the field
hand-tunes** — we already have the real thing from D65, so the field's crop hack is a fallback we do
not need. `GachaArtShowcase.tsx` is the existing card→full-art overlay if a "see the whole portrait"
affordance is wanted.

**③ Styling gates.** `VAPOR_PATTERNS.md` §5 (border-radius scale), §6 (spacing & layout), §7 (button
taxonomy — "match the closest one exactly"), §11 (net-new components), §12 (component intent) and
§13 (the pre-ship checklist) all bind a net-new card grid. §8.4's own line — "Styling per
`VAPOR_PATTERNS.md`; theme dressing rides the existing surface rules (D31)" — means the gallery is
kit-level with token dressing, not a per-theme bespoke surface; the gacha card above is the
*structural* precedent, not a thing to copy into the kit.

**④ Organization features the evidence prices, in rough ascending cost.** Search (3/3, trivial) ·
a persisted view/sort preference (Agnai's `localStorage` cache; ctrl-b's equivalent home is the `ui`
store, which already persists `tab`/`layout`) · a live count line (Risu) · a favourites GROUP rather
than a favourites sort (Agnai) · tags/tag-chips (ST/Agnai) · folders (all three, all differently) ·
soft-delete/trash (Risu) · bulk mode (ST/Agnai). Paging is the field's universal answer to scale and
is almost certainly moot at ctrl-b's agent counts — **0/3 virtualize**.

**⑤ Selection.** ctrl-b's gallery merges two things the field keeps apart: §8.4 says "opening a card
is the full agent editor", whereas 3/3 peers make the primary tap *start talking to* the character
and route editing through a second gesture. ctrl-b's own second surface already exists — the chat
agent picker (§8.4: "The chat agent picker gets small avatars") — so the "talk to" verb has a home
and the gallery can legitimately own "edit"; but the divergence is real and worth stating in the
design rather than inheriting silently.

**⑥ ChatThread bubbles.** No avatar exists today: `frontend/src/components/ChatThread.tsx` renders
sys/user/bot bubbles with a text who-line (`:34-38`). The field's precedent is 3/3 yes, both sides,
always toggleable — but the toggle's **scope** splits: per-character (Risu `hideChatIcon`), global UI
setting (Agnai `avatarSize: 'hide'`), or a side effect of a chat style (ST Document). ctrl-b's
existing lever for that class of preference is the `ui` store + the Appearance Switch (CLAUDE.md's
"different code for similar things" rule points there rather than at a new per-agent flag). Two
concrete collisions to know about before designing the slot: (a) Risu and Agnai both use the avatar
slot as the **TTS transport control**, and ctrl-b already has a per-bubble read-aloud toggle in the
assistant who-line (`ChatThread.tsx:343-346`) — the slot is occupied; (b) Agnai's trick of giving a
height only to the *circle* variant is how a 2:3 agent portrait can sit beside a bubble without any
aspect plumbing.

**⑦ Per-agent voice.** ctrl-b's TTS voice today is `ModelCfg.voice` — `backend/app/config.py:214`
(`voice: str | None = None  # TTS server voice id`), a field on a provider's model catalog entry,
resolved through the `voice.tts` chain in `backend/app/core/provider_registry.py:658-672`. There is
**no per-agent binding of any kind**. The field offers two shapes: an optional field on the
character (Risu, Agnai) or a name-keyed map in settings (ST). `ROLEPLAY_PLAN.md` §3.1 already
describes the `AgentDef` expansion as "flat, all optional, all defaulted", and the owner's
"shape data to extend, not to migrate" directive argues against a second name-keyed sibling map next
to `agents` — so the cheap seam, if the owner wants one, is one more optional `AgentDef` field beside
`avatar`/`background`, naming a voice id resolved against the existing `voice.tts` target. Agnai's
`voiceDisabled` and the global `texttospeech.enabled` master gate are the precedent for keeping
"this agent is silent" separate from "voice is off". Whether this is v1 or a recorded seam is the
owner's call; §8 says the field considers it table stakes.
