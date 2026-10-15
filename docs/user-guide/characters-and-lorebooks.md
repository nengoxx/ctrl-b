# Characters and lorebooks

In ctrl-b a **character** is simply an [agent](agents.md) that uses the character fields — a persona, a greeting, a scenario, example dialogue — usually together with a **lorebook**: a set of reference notes that are pulled into the conversation when certain words come up. You can write characters by hand, or import the SillyTavern-style character cards (V1, V2 and V3) you already have, and export them back out.

## How to use it

### Turn on the character fields

Conf → **Roleplay** → **Roleplay fields** shows the character fields on every agent and the card import button in the Agents gallery. It only changes what you see: a character keeps working with it off, and an agent that already uses a character field shows it either way.

### Import a character card

1. In the Agents gallery, open **Add agent** and tap **Import character card**.
2. Pick the file. Accepted: a **PNG** card (the card is stored inside the image), a **JSON** card, or a **CHARX** archive (including the "JPEG card" form, an archive attached behind a JPEG). The file type is detected from its bytes, not its name.
3. A report card appears above the grid: what was imported, what was removed, and what ctrl-b stores but does not use.

What you get:

- **A new agent.** Its slug comes from the card's name (a number is added if that slug is taken); its display name is the card's nickname or name.
- **Persona** — the card's system prompt, description and personality, joined in that order into `SOUL.md`. A card with none of them gets a short placeholder persona, so it never answers as the plain assistant.
- **Greeting** (`first_mes`), **alternate greetings** (stored, not yet pickable), **example dialogue**, **scenario** and **post-history instructions**.
- **Avatar** — the PNG itself (with the card data taken out), or the CHARX icon.
- **The card's embedded lorebook**, if any, imported as a lorebook and attached to the new agent.
- Safe defaults: **Talk** duties, only the tools ticked under Conf → Roleplay → **Character tools** (`web_search` by default), no skills, and the privilege every agent inherits from `agent.defaults` (Confirm, unless you changed it). Widen them in the agent's editor.
- **Scripts are removed.** Card fields that carry code or prompt rewriting for other apps (`customScripts`, `triggerscript`, `virtualscript`, `lowLevelAccess`, `regex_scripts`) are stripped wherever they sit, and the report lists them. In a CHARX archive only the card and its icon are ever opened.
- Everything else the card carried is kept beside the agent (`card.json`), so an export can give it back.

Limits: 15 MB per file, 2 MB of card data, and caps on CHARX archive contents (all in `roleplay.card_import`). WebP cards and multi-image V3 assets (sprites, emotions) are not imported; extra assets are noted in the report.

### Export a character

In the agent's editor tap **export**, then **PNG card** or **JSON card**. Unsaved edits are not exported — the button says **save first**.

- **PNG card** — the agent's avatar (the whole image, not your crop) or its letter tile, carrying the card inside it. SillyTavern and other card apps read it.
- **JSON card** — the V3 card as a file.
- The agent's own enabled lorebooks are embedded in the card (several are merged into one). Global lorebooks are not.
- If you have not changed the persona since import, its three original parts come back separately; an edited persona exports as the card's description.

The root agent can be exported too.

### What a lorebook does

A lorebook is a list of **entries**. Each entry has text (**Content**) and **Keys** — words that summon it. At the start of each reply, ctrl-b scans the conversation and adds every entry that matches to what the model is sent, before it writes anything. The agent does not choose or see this happening; nothing appears in the chat.

How matching works:

- **What is scanned:** your new message plus the last 2 chat messages before it (`lorebooks.scan_depth`; `0` = only your new message). Only chat text — no tool output, no attachment contents. Each message is scanned as `Name: text`, so a key that is a speaker's name fires on that speaker's lines (`lorebooks.include_names`).
- **Keys are plain text**, never patterns. By default they ignore case and match whole words (**Case sensitive**, **Whole words** per entry). A key of several words matches wherever that exact phrase appears, whole words or not. Macros such as `{{char}}` and `{{user}}` work in keys.
- **Second gate** (optional): extra keys that must also match (**Gate logic** `and_any`) or must not match (`not_any`).
- **Always on**: the entry is added on every reply, no keys needed.
- An entry with no keys that is not **Always on** never fires, and neither does one whose content is empty once its macros are filled in.
- **Where it goes:** **Position** `head` (beside the agent's instructions, the default) or `tail` (after the conversation, just before the post-history instructions).
- **Budget:** at most 4,000 characters of entry text per reply (`lorebooks.budget_chars`), counted across head and tail together. Over the budget, the entries with the lowest **Priority** are dropped first; an entry without a priority uses its **Order** number. Survivors are placed by **Order**, lowest first.
- **Which books:** the books attached to the agent, plus the **Global lorebooks** every agent reads. A book attached both ways counts once. A disabled book or entry is skipped.
- **No chance rolls.** A matching entry always fires: SillyTavern's per-entry probability is stored when you import a book but not used yet ([ISS-45](../ISSUES.md)).

### The lorebook editor

Conf → **Lorebooks** lists your books. Each row has an on/off switch and says who uses it (`used by` and the agents' names · `global` · `unused`).

- **Add** a book by name; its file is `lorebooks/<slug>.yaml` in your data folder. A name whose slug is already taken is refused, so an existing book is never overwritten.
- Open a book for its **Name**, **Description** and its entries, shown as a collapsed list (keys, a preview line, an on/off switch per entry). Open an entry to edit **Keys**, **Content**, **Always on**, **Second gate**, **Gate logic**, **Case sensitive**, **Whole words**, **Position**, **Order** and **Priority**. **+ add entry** and **remove entry** are in the same list.
- Fields ctrl-b has no editor for (from an imported book) are kept untouched when you save.
- **import a lorebook** reads a lorebook file: the V3 lorebook format, a SillyTavern world-info export, or a bare list of entries. The report counts what changed on the way in — SillyTavern's eight insertion positions become `head` or `tail`, and features stored but not used (probability, inclusion groups, recursion, per-entry scan depth, keys that look like patterns) each get a count line.
- **export** saves the book as a SillyTavern world-info file (save first).
- **Delete** removes the file. Agents that still list it keep the link and simply stop getting its entries; the picker shows the book as `missing`.

Attach a book to one agent in its editor (**Lorebooks**), or to every agent under **Global lorebooks** at the bottom of the same Conf group, next to **Scan depth**, **Budget** and **Import cap**.

### Prompt cache and macros

Head entries sit with the agent's instructions. When the set of matching head entries changes from one message to the next, the model server has to re-read the whole conversation instead of reusing its cache, which makes that reply slower to start on a local model. Tail entries only change the end. The same is true of macros that change every message (`{{random}}`, `{{roll}}`, the time macros, `{{idle_duration}}`) inside a head entry: the editor warns you under the entry while you type, and an import counts them. See [Agents → Macros](agents.md#macros).

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`roleplay.enabled`](configuration-reference.md#roleplay) | Shows the character fields and the card import | `false` | live |
| [`roleplay.default_tools`](configuration-reference.md#roleplay) | The tools an imported character starts with, and the tools an agent gets when you switch its Duties to Talk ([Agents](agents.md#the-agent-editor)); read at the next import or switch | `[web_search]` | live |
| [`roleplay.card_import.*`](configuration-reference.md#roleplaycard_import) | Card size caps: file, card data, CHARX contents | 15 MB / 2 MB / … | live |
| [`roleplay.personas` / `default_persona`](configuration-reference.md#roleplay) | Your personas — who `{{user}}` is ([Agents → Personas](agents.md#personas)) | none | next chat turn |
| [`lorebooks.books`](configuration-reference.md#lorebooks) | Global lorebooks, read by every agent | none | next chat turn |
| [`lorebooks.scan_depth`](configuration-reference.md#lorebooks) | Prior chat messages scanned with your new one | `2` | next chat turn |
| [`lorebooks.budget_chars`](configuration-reference.md#lorebooks) | Entry text allowed per reply | `4000` | next chat turn |
| [`lorebooks.include_names`](configuration-reference.md#lorebooks) | Scan each message as `Name: text` | `true` | next chat turn |
| [`lorebooks.max_import_bytes`](configuration-reference.md#lorebooks) | Largest lorebook file an import reads | 15 MB | live |

## Edge cases & limits

- **Probability and firing cadence are not built.** Every matching entry fires every time; an imported entry meant to fire "10% of the time" either always fires (when it has keys) or never does (keyless, not Always on) ([ISS-45](../ISSUES.md), [ISS-46](../ISSUES.md)).
- **Not supported:** recursion (entries triggering entries), inclusion groups, timed effects, per-entry scan depth, insertion at a fixed depth, pattern keys. They survive import and export but do nothing here.
- **Alternate greetings** are kept and exported, but new conversations always open with the main greeting.
- **Deleting a book** never breaks a reply; agents that list it just stop getting its entries.
- **Android downloads.** A card picked from Downloads can be reported as 0 bytes by the phone; pick it again through a file manager ([ISS-47](../ISSUES.md)).
- **Deleting a character** keeps its lorebooks and images in their libraries ([Agents](agents.md)).

## Under the hood

Design: [`docs/ROLEPLAY_PLAN.md`](../ROLEPLAY_PLAN.md) (cards §5, lorebooks §6, export §15).
