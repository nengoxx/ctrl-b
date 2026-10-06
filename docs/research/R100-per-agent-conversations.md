# R100 — Conversations per agent vs one switchable conversation — peer field pass (2026-10-06)

**Serves:** [`ROADMAP.md` §A15](../ROADMAP.md) (past conversations + conversations per agent).
**Status:** evidence, no decision yet. Opus 5.5 research lane, one agent, no subagents.
**Confidence marks:** **[V]** verified by reading the source at the SHA below (or by running the
binary locally) · **[R]** reported by a secondary source (blog, press, help-centre summary) ·
**[U]** expected but not checked.

## Sources (pinned)

| Project | Ref read | Date | How |
|---|---|---|---|
| SillyTavern | `release` @ `06bde939fb` (v1.19.0) | 2026-09-14 | shallow clone |
| open-webui | `main` @ `8bd8b4fac5` (v0.11.4) | 2026-09-21 | shallow clone |
| LibreChat | `main` @ `f10b1d91f1` (v0.8.8) | 2026-09-30 | shallow clone |
| Agnai (agnaistic) | `dev` @ `fccee00` | 2026-06-13 | shallow clone (added: it's the RP peer that does the hybrid) |
| opencode | `dev` @ `3f393d7` | 2026-10-06 | shallow clone |
| Hermes agent | local install @ `cc23b725a3` | 2026-09-15 | `hermes --help` + source grep |
| Codex CLI | local `codex-cli 0.144.6` | — | `codex resume --help` |
| Claude Code | local binary | — | `claude --help` + `~/.claude/projects/` first-hand |
| Telegram | core.telegram.org (`dialog` constructor, `messages.setTyping`) | fetched 2026-10-06 | official API docs |
| Discord | docs.discord.com `resources/channel` + Dec-2023 redesign press | fetched 2026-10-06 | official docs + [R] |
| Android/Material | developer.android.com list-detail adaptive layout | fetched 2026-10-06 | official docs |
| Character.AI | secondary sources only | 2026 | [R] |

Clones live in `/home/emma/.cache/tmp/research-clones/` (delete when done).

Prior dossiers this one leans on (not re-bought): **R47** (per-message model attribution) ·
**R64/R67/R87** (SillyTavern character model, gallery) · **R35** (peer turn architecture) ·
**R45** (notification-tap routing).

---

## 1. SillyTavern — per-character chats; groups are a separate kind

**Storage [V].** A solo chat is a JSONL file under a per-character directory:
`src/endpoints/chats.js:551` —
`const chatFilePath = path.join(request.user.directories.chats, cardName, sanitize(chatFileName));`
where `cardName` is the avatar filename without `.png`. Group chats live in a flat sibling
directory, `directories.groupChats/<chatId>.jsonl` (`chats.js:878`), and the *group* is a separate
record (`directories.groups/<id>.json`) whose `chats: string[]` lists its chat files
(`public/global.d.ts` `interface Group { id, name, members: string[], disabled_members, chat_id,
chats: string[], generation_mode, activation_strategy, allow_self_responses, … }`).

**The JSONL line shapes [V]** (`public/global.d.ts`). Line 0 is a header; every other line is a message:

```ts
interface ChatHeader {
    chat_metadata: ChatMetadata;
    /** @deprecated For backward compatibility ONLY */
    user_name: 'unused';
    /** @deprecated For backward compatibility ONLY */
    character_name: 'unused';
}
interface ChatMessage {
    name?: string;  mes?: string;  title?: string;
    gen_started?: MessageTimestamp;  gen_finished?: MessageTimestamp;  send_date?: MessageTimestamp;
    is_user?: boolean;  is_system?: boolean;
    force_avatar?: string;  original_avatar?: string;
    swipes?: string[];  swipe_info?: SwipeInfo[];  swipe_id?: number;
    extra?: ChatMessageExtra;   // extra.api, extra.model, extra.type, extra.tool_invocations, …
};
```

The speaker is just `name` + `is_user`. In groups the member identity rides in
`original_avatar` (the pooled strategy reads it: `group-chats.js:1210`
`if (message.original_avatar) { spokenSinceUser.push(message.original_avatar); }`). The model that
produced a turn is `extra.api`/`extra.model` (used only to decide whether thought signatures may be
replayed, `openai.js:625`).

**Selecting a character loads its *last opened* chat — not the most recently active one [V].**
Each character card persists a `chat` field = the file name of the chat currently bound to it.
`selectCharacterById` (`public/script.js:875`) clears the view, sets the id and calls `getChat()`,
which posts `file_name: characters[this_chid].chat` (`script.js:7634`). `openCharacterChat`
(`script.js:7744`) and `doNewChat` (`script.js:10618`) rewrite that field:
`characters[this_chid].chat = \`${name2} - ${humanizedDateTime()}\`;`. Only when the bound chat is
deleted/replaced does ST fall back to the newest by `last_mes` (`replaceCurrentChat`, `script.js:1405`):
`chats.sort((a, b) => sortMoments(timestampToMoment(a.last_mes), timestampToMoment(b.last_mes)));`.
A character with no chat gets a fresh file seeded with the greeting (`getChatResult` →
`getFirstMessage()`, alternate greetings become swipes).
*Caveat (2026-10-06, council O27):* the card — and so its bound `chat` — lives on the ST server, so the binding is
per-ACCOUNT, not per-device (the card-save call itself was not quoted in this pass).

**"New chat" is per character [V]** (`doNewChat`): new file name `"<Char> - <date>"`, bound to the
card; the old file stays in the character's directory. Past chats for a character =
`POST /api/characters/chats` (one row per file: `file_name`, `file_size`, `chat_items`, `mes` = last
message text, `last_mes` = mtime; `getChatInfo`, `chats.js:413`).

**Cross-character "recent chats" exists, on the welcome screen [V].** `POST /api/chats/recent`
(`chats.js:1054`) walks every character dir + every group, sorts **pinned first, then by file
mtime**, returns the same row shape. Pins are `{avatar|group, file_name}` kept in `accountStorage`
(`public/scripts/welcome-screen.js:41`, `pinnedChatsKey = 'pinnedChats'`), which persists through
`saveSettingsDebounced()` — i.e. server-side user settings, so pins follow the account across
devices. Default shown: `DEFAULT_MAX_DISPLAYED = 15`.

**Can you swap the character inside a solo chat? No [V].** The solo chat is bound to one card. The
escape hatches:
- `/sendas name=<char>` (`slash-commands.js:1255`) — writes a message *as* another character into the
  current chat (sets `force_avatar`); it does **not** generate.
- **Convert to group** (`bookmarks.js:331` `convertSoloToGroupChat`) — **one-way**:
  `"Are you sure you want to convert this chat to a group chat?" + "This cannot be reverted."`; creates
  a group with the one member and copies the chat.
- `/go <name>` (`slash-commands.js:1591`) — *"Opens up a chat with the character or group by its
  name"* — navigation, not an in-thread switch.

**Group turn-taking [V]** (`group-chats.js:122`): `activation_strategy` ∈ `NATURAL 0 · LIST 1 ·
MANUAL 2 · POOLED 3`; `generation_mode` ∈ `SWAP 0 · APPEND 1 · APPEND_DISABLED 2`.
- NATURAL (`activateNaturalOrder`, `:1242`): **a member's name appearing in the user's message
  activates that member** (`// find mentions (excluding self)` — whole-word match of the
  character name, no `@` needed), then each member rolls against its `talkativeness`, then one random
  fallback; the last speaker is banned unless `allow_self_responses`.
- LIST: every enabled member, in order. POOLED: someone who hasn't spoken since the user.
  MANUAL: only on explicit trigger.
- Explicit "this one replies": `params.force_chid` (the per-member force-talk button) and
  `/trigger <member index|name>` (`slash-commands.js:1806`).

**How the model is told who said earlier turns [V]** (`openai.js:595`, setting `names_behavior`,
default `DEFAULT`):
```js
case character_names_behavior.DEFAULT:
    if ((selected_group && chat[j].name !== name1) || (chat[j].force_avatar && chat[j].name !== name1 && …)) {
        content = `${chat[j].name}: ${content}`;
    }
```
i.e. **name-prefixed content in groups and on `/sendas` turns; nothing in a plain solo chat**.
Other modes: `NONE`, `CONTENT` (always prefix), `COMPLETION` (OpenAI `name` field).

**Concurrency [V]: one generation at a time, and you cannot leave while it runs.**
`selectCharacterById`: `if (selected_group && is_group_generating) { return; }` and the switch body is
wrapped in `if (!is_send_press) { … }` — clicking another character mid-generation silently does
nothing. No background turns, no list-level live status.

## 2. open-webui — one global list; the model is a per-chat (and per-message) setting

**Chat row [V]** (`backend/open_webui/models/chats.py:129`): `id, user_id, title, chat (JSON),
created_at, updated_at, share_id, archived, pinned, meta, folder_id, tasks, summary,
current_message_id, last_read_at, timer_at`. The chat JSON carries `models: [...]` (the selector's
value, restored on open: `Chat.svelte:2306 models: chatContent?.models`).

**Per-message attribution [V]** — each assistant message is created with
`model: model.id, modelName: model.name ?? model.id, modelIdx` (`Chat.svelte:3265`). (R47 covers display.)

**Switching the model mid-chat: history stays, prior turns are NOT re-attributed [V].** The backend
replays the branch with `MESSAGE_REPLAY_KEYS = ('id','role','content','output','files',
'contextSummary','usage','model')` (`utils/middleware.py:2221`); the per-message `model` is used for
exactly one thing:
```py
# reasoning_details can be model/provider-bound, so only replay them
# for output produced by the same model.
if message.get('role') == 'assistant' and message.get('model') != model['id'] and isinstance(output, list):
    message['output'] = strip_reasoning_details(output)
```
Every earlier assistant turn reaches the new model as a plain `assistant` message — **the same
"reads the previous agent's turns as its own" shape as ctrl-b's ISS-50.**

**`@model` and `/model` [V].** Typing `@` (or dragging a model onto the composer) sets
`atSelectedModel`, shown as a chip above the composer with an ✕ (`MessageInput.svelte:1905`); while
set it overrides the chat's selection for each send (`Chat.svelte:3247`). It is **sticky until
dismissed** — the only reset in `Chat.svelte` is `handleModelCommand` (`:3032`); it is not cleared
after a send. `/model <id>` replaces the chat's selection (`selectedModels = [model.id]`,
toast `Model switched to: …`). Multi-model = several ids in `selectedModels` → sibling responses with
`modelIdx` (side-by-side).

**Sidebar [V].** Global list (not grouped by model), date sections from `getTimeRange`
(`src/lib/utils/index.ts:1308`: `Today · Yesterday · Previous 7 days · Previous 30 days · <Month> ·
<Year>`), a pinned section, folders, a search modal (`SearchModal.svelte`; list endpoint returns
`snippet` + `last_read_at`, 60/page), tags, archive. **Pinned models** sit above the chats and link to
`href="/?model={model?.id}"` (`PinnedModelItem.svelte:35`) — i.e. *a new chat with that model*, not
"that model's conversation". Row = title + relative time (`formatTimeAgo`: `5m`, `3h`, `2d`…); **no
avatar, no last-message preview** in the row (a hover preview exists on desktop). On mobile, selecting
a row navigates and closes the drawer: `if ($mobile) { goto(\`/c/${id}\`); showSidebar.set(false); }`
(`ChatItem.svelte:165`) — the list is a **drawer**, not the root screen.

**Live status for non-open chats [V] — the most complete in the field.**
- *Running:* generation is a server task; `main.py:1875` emits
  `{'type': 'chat:active', 'data': {'active': True, 'folder_id': …}}` when tasks start and
  `active: False` when the last task for that chat deregisters (`:1748`). The list endpoint merges it
  (`add_active_state_to_chat_list`), and the row shows a spinner: `{#if active} <Spinner/>`.
- *Unread:* **server-side per-chat read marker** `chat.last_read_at`; unread ⇔
  `updated_at > last_read_at`. Opening a chat emits socket `events:chat {type:'last_read_at'}`; the
  server stamps it and broadcasts `chat:list` to `room=f'user:{user["id"]}'` — **every device of the
  user clears the dot** (`socket/main.py:611`). Row shows a `size-1.5 bg-sky-500 rounded-full` dot.
  Explicit **"mark unread"** (`POST /{id}/unread` sets `last_read_at = 0`) and **"mark all read"**
  (`POST /read`). Migration `b7c8d9e0f1a2` backfilled `last_read_at = updated_at` (no false unreads on
  upgrade). Folders get `folder_unread_counts`.
- *Arrival:* in `+layout.svelte:735`, a `chat:completion` with `done` for a chat that is **not the open
  one** (or tab in background) → a 15 s toast whose click does `goto(\`/c/${event.chat_id}\`)`, plus a
  browser `Notification` if enabled and `$isLastActiveTab`.

**Channels — the in-thread `@model` with attribution [V]** (`routers/channels.py:976`
`model_response_handler`). In a (multi-user) channel, an `@model` mention — or replying to a model's
message — summons **one reply** from that model. The thread history is flattened into the system
prompt with **name prefixes**:
```py
thread_history.append(f'{username}: {replace_mentions(thread_message.content)}')
…
'content': f'You are {model.get("name", model_id)}, participating in a threaded conversation. Be concise and conversational.'
    + (f"Here's the thread history:\n\n\n{thread_history_string}\n\n\nContinue the conversation naturally as {model.get('name', model_id)}, …")
```
(model turns are labelled by the model's name, humans by user name; the user's new message is
`f'{user.name}: {message_content}'`). This is a different product surface from Chats.

## 3. LibreChat — one global list; switching continues the conversation, gated by a user setting

**Schemas [V].** Message (`packages/data-schemas/src/schema/message.ts`): `messageId, conversationId,
model, endpoint, parentMessageId, sender, text, isCreatedByUser, iconURL, addedConvo, …`.
Conversation (`convo.ts`): `conversationId, title ('New Chat'), agent_id, initial_agent_id, endpoint,
model, pinned, …`. `initial_agent_id` is written **only on insert** (`$setOnInsert`,
`methods/conversation.ts:2384`) while `agent_id` follows later switches — the schema itself admits a
conversation's agent can change.

**Switching endpoint/agent mid-conversation [V]** (`client/src/utils/endpoints.ts:266`
`getConvoSwitchLogic` + `hooks/Input/useSelectMention.ts`):
```ts
const endpointsMatch = currentEndpoint === newEndpoint;
const shouldSwitch = endpointsMatch || modularChat || isAssistantSwitch;
…
const isModular = isCurrentModular && isNewModular && shouldSwitch;
if (isExistingConversation && isModular) { /* We don't reset the latest message */ newConversation({ template: currentConvo, preset, keepAddedConvos: true }); return; }
// else: template has conversationId: 'new' → a NEW conversation
```
So: agent → agent (same `agents` endpoint) **continues in place**; crossing endpoints continues only
if both are "modular" (`modularEndpoints = {anthropic, google, openAI, azureOpenAI, custom, agents,
bedrock}`, `data-provider/src/config.ts:3568`) **and** the user setting is on; otherwise it **forks
to a new conversation**. Nothing blocks.

**The only user toggle found anywhere in the pass [V]:** `modularChat: atomWithLocalStorage('modularChat', true)`
(`client/src/store/settings.ts:108`), label `"com_nav_modular_chat": "Enable switching Endpoints
mid-conversation"`. Note its OFF state means *"start a new conversation with the new endpoint"* —
not *"open that agent's existing conversation"*. It is per-browser (localStorage), not per-account.

**`@` command [V]:** `"com_ui_mention": "Mention an endpoint, assistant, or preset to quickly switch
to it"`; toggleable (`"com_nav_at_command_description": "Toggle command \"@\" for switching endpoints,
models, presets, etc."`). It is a **persistent switch** through the same `getConvoSwitchLogic`, not a
one-reply override.

**How the agent is told who said earlier turns [V]:** `api/server/controllers/agents/client.js:2572`
formats every row with
`formatMessage({ message, userName: this.options?.name, assistantName: this.options?.modelLabel })`,
and `formatMessage` (`api/app/clients/prompts/formatMessages.js:61`) does
`if (assistantName && formattedMessage.role === 'assistant') { formattedMessage.name = assistantName; }`
— **every prior assistant turn is stamped with the CURRENT agent's label** (or no name). The
per-message `sender` is not used. Same ISS-50 class as open-webui, arguably worse (actively
mislabelled when a label is set).

**List + live status [V].** Date-grouped (`client/src/utils/convos.ts:19` `today · yesterday ·
previous7Days · previous30Days · <month>`), a **Pinned** section (`PinnedSection.tsx`, `convo.pinned`),
projects, archive filter, sort by `updatedAt | createdAt | title` (`chatFilters.ts`). **Running:**
`useActiveJobs` polls `GET /api/agents/chat/active` (`staleTime 5_000`, `refetchOnWindowFocus:
'always'`, interval while non-empty) and `groupConversationsWithRunning` (`Conversations/running.ts`)
**hoists running conversations into a "Running" group at the top** of the list, each row showing a
`Spinner` (`Convo.tsx:273`). **No unread concept**: no `unread`/`lastRead` field in the convo schema
or the list components (grep, 2026-10-06).

## 4. Agnai — per-character chats that can take extra characters, with a speaker control [V]

Included because it is the one RP peer that does the **hybrid** natively. `common/types/schema.ts`:
```ts
export interface Chat { …; characterId: string; characters?: Record<string, boolean>;
                        tempCharacters?: Record<string, AppSchema.Character>; … }
export interface ChatMessage { …; msg: string; characterId?: string; userId?: string; name?: string; … }
```
A chat is created for one character (`characterId`) and **more characters can be added to the same
chat later** (`characters` map; `tempCharacters` = chat-local NPCs). The footer shows **character
"pills"**; tapping one (or `Alt+1…9`) calls `requestMessage(charId)` →
`responseStore.request(chatId, charId)` (`web/pages/Chat/ChatDetail.tsx:282, 335`) — *this character
replies next, here*. History lines are **always** author-prefixed (`common/prompt.ts:930`
`fillPlaceholders`: ``return `${prefix}: ${msg}` ``), and characters can be hidden from one another
(`invisibleChars`).

## 5. Character.AI — [R] only

- Conversations are stored **per character**; returning to a character resumes its latest chat;
  "Recent chats" on home is the cross-character door; **no global full-text history search**
  ([llmnesia](https://www.llmnesia.com/blog/how-to-find-old-character-ai-conversations)).
- **Many chats per character**: "New chat" starts fresh (old kept, nothing carried over); "Start new
  chat from here" forks at a message
  ([roborhythms](https://www.roborhythms.com/new-chat-on-character-ai/)). History reached from the
  chat's settings/persona menu.
- **Group chats are a separate kind** ("Character Group Chat", launched 2023-10, up to ~10 characters;
  a mention by name makes that character respond; auto-reply toggle)
  ([TechCrunch 2023-10-11](https://techcrunch.com/2023/10/11/character-ai-introduces-group-chats-where-people-and-multiple-ais-can-talk-to-each-other),
  [arcanumrpgs 2026](https://arcanumrpgs.com/blog/character-ai-group-chat/)). Speaker selection
  algorithm is unpublished.
- **Correction to A15's wording:** it is not "one ongoing chat per character" — it is *many* per
  character with the **latest resumed by default**.

## 6. Agent CLIs — session scoping and resume (secondary here)

| Tool | Scope of the session list | "Resume last" | Per-agent scoping |
|---|---|---|---|
| Claude Code [V] | per project dir (`~/.claude/projects/<cwd-slug>/<session>.jsonl`, first-hand) | `-c, --continue` "Continue the most recent conversation in" the current dir; `--resume` picker; `--fork-session` | `--agent <agent>` sets the session's agent; sessions are not listed per agent |
| Codex CLI [V] | global store, picker **filtered to cwd** by default (`--all` "disables cwd filtering and shows CWD column") | `codex resume --last` "Continue the most recent session without showing the picker" | none |
| opencode [V] | per project (`session.projectID = ctx.project.id`, `session/session.ts:516`) | `-c/--continue` "continue the last session" (first root session: `list().find((item) => !item.parentID)`); `--session`, `--fork` | **agent is per MESSAGE** inside one session (`agent: Schema.String`, `packages/schema/src/v1/session.ts`) — Tab switches build/plan mid-session |
| Hermes agent [V] | per **profile** (each profile = an isolated `HERMES_HOME` with its own `state.db`; `hermes profile` "Manage profiles — multiple isolated Hermes instances") | `-c [NAME]` "Resume a session by name, or the most recent"; `-r latest` "(workspace-scoped, like -c with no name)" | profile = the agent; switching profile = switching session store |

**opencode tells the model about a switch only for plan→build [V]** (`session/reminders.ts`): when an
earlier assistant message has `agent === "plan"` and the current agent is `build`, a synthetic text
part is appended to the user turn:
```
<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode. …
</system-reminder>
```
No general "the previous turns were by agent X" note; the persisted per-message `agent` drives the UI
label (R47: `"Build · Claude Sonnet 4"`).

## 7. Messenger list UX — Telegram / Discord / Android guidance

**Telegram's dialog object is the reference row model [V]** (core.telegram.org `dialog`
constructor): `pinned` "Is the dialog pinned" · `unread_mark` "Whether the chat was manually marked as
unread" · `top_message` "The latest message ID" · `read_inbox_max_id` "Position up to which all
incoming messages are read" · `read_outbox_max_id` "Position up to which all outgoing messages are
read" · `unread_count` · `unread_mentions_count` · `draft` · `folder_id` · `notify_settings`.
⇒ **unread is a server-side, per-account high-water mark** (one integer per dialog), so it syncs
across devices by construction; "mark as unread" is a separate manual flag, not a rewind of the marker.
Typing: `messages.setTyping` "Sends a current user typing event … to a conversation partner or group"
(re-send cadence/timeout not on the fetched page — **[U]**, commonly reported ~5–6 s).

**Discord [V]/[R].** Typing: "Post a typing indicator for the specified channel, which **expires after
10 seconds**" [V, docs.discord.com]. Channels carry `last_message_id` (list sort key) [V]; read states
are **not** in the public API [V: absent from the channel page]. Mobile: the Dec-2023 redesign moved
DMs into a **Messages tab** in a bottom bar (Servers · Messages · Notifications · You), with favourites
pinned to the top [R: [Engadget](https://www.engadget.com/discord-overhauls-its-mobile-app-with-new-tabs-messaging-features-and-more-170035917.html),
[Discord support](https://support.discord.com/hc/en-us/articles/12654190110999-New-Mobile-App-Updates-Layout)];
a 2026 redesign reportedly walks parts of that back
([piunikaweb 2026-03-19](https://piunikaweb.com/2026/03/19/discord-mobile-app-redesign-desktop-ui/)) [R].

**Row anatomy (field convention) [R].** Avatar (≈40 px circle) · name · one-line last-message preview ·
trailing time · unread badge (count, or dot) · typing replaces the preview — e.g. MUI X
`ChatConversationList` slots `itemAvatar · title · preview · timestamp · unreadBadge`
([MUI](https://mui.com/x/react-chat/material/conversation-list/)); M3 lists provide leading avatar +
headline + supporting text + trailing text ([m3](https://m3.material.io/components/lists/guidelines)).
Sort = last activity; pinned above.

**Phone layout + back [V]** (Android adaptive list-detail): "When screen size is limited, the detail
pane (since an item has been selected) takes over the whole space"; default back
(`PopUntilScaffoldValueChange`): "In a single-pane layout, pressing back will skip through content
changes within the detail view and **return to the list view**." Telegram/WhatsApp make the list the
**root screen** [R, common knowledge, not fetched]; open-webui/LibreChat use a **drawer** [V for
open-webui]; Discord uses a **tab** [R].

## 8. The hybrid question — who offers both, and how

| App | Per-agent/character conversations | Switch responder inside one conversation | How the switch is exposed | How the model learns who said earlier turns |
|---|---|---|---|---|
| SillyTavern [V] | yes (solo chats per character) | **not in solo**; yes in groups | groups: name mention (NATURAL), force-talk button, `/trigger`; solo: `/sendas` (write-only), one-way **convert to group** | `"Name: "` content prefix in groups/`sendas` (default); nothing in solo |
| Agnai [V] | yes | **yes, in place** (add characters to the chat) | footer **character pills** / `Alt+N` | always `"Name: msg"` lines |
| Character.AI [R] | yes (many per char, latest resumed) | groups only (separate kind) | name mention, auto-reply | unpublished |
| open-webui Chats [V] | no (global list; pinned model = new chat) | yes | model selector, sticky `@model` chip, `/model` | **nothing** — plain `assistant` turns |
| open-webui Channels [V] | n/a | yes, **one reply per mention** | `@model` or reply-to-model | history flattened into system prompt as `"Name: content"` + `"You are X, participating in a threaded conversation"` |
| LibreChat [V] | no (global list) | yes (continue in place; else fork) | model/agent picker, `@` mention (persistent) | current agent's label stamped on **all** assistant turns |
| opencode [V] | no (per project) | yes (Tab) | agent cycle key | synthetic `<system-reminder>` on plan→build only |

**A user setting choosing "switching opens its chat" vs "changes responder here": ABSENT** in every
peer read. The nearest is LibreChat's `modularChat` ("Enable switching Endpoints mid-conversation"),
whose alternative is *a new conversation*, not *the agent's existing one*. No peer combines
"pick = navigate to that agent's thread" with a toggle.

**One-shot (single reply) vs sticky:** only **open-webui Channels** (per mention), **ST groups**
(force-talk / `/trigger` / name mention) and **Agnai pills** are per-reply; open-webui Chats' `@model`
and LibreChat's `@` are **sticky** until changed.

## 9. Live status in the list (summary)

| App | Running indicator for a non-open conversation | Unread | Cross-device read sync | Arrival notice |
|---|---|---|---|---|
| open-webui [V] | spinner on row (`chat:active` socket event from server tasks) | blue dot, `updated_at > last_read_at` + manual mark-unread | **yes** (server column, broadcast to `user:<id>` room) | toast → `goto(/c/<id>)`, browser Notification |
| LibreChat [V] | "Running" group hoisted to the top + spinner (polls `/api/agents/chat/active`) | **none** | n/a | not checked [U] |
| SillyTavern [V] | none (one generation at a time; switching blocked) | none | n/a | none |
| Telegram [V] | typing action (ephemeral) | `unread_count` from `read_inbox_max_id` + `unread_mark` | **yes** (server marker) | push |
| Discord [V]/[R] | typing, expires 10 s | yes (client read states, not public API) | yes [R] | push |

## 10. What was WRONG (corrections to premises we held)

1. **A15: "SillyTavern — pick a character → its last chat loads."** Nuance: it loads the chat **bound
   to the card** (`characters[id].chat`, rewritten on open/new) — the last *opened*, not the last
   *active*. The newest-by-`last_mes` rule applies only when the bound chat is deleted/replaced.
2. **"Several agents working at the same time" is not a SillyTavern property.** ST runs one
   generation and ignores character clicks while it runs. The concurrent-threads + list-status
   precedent is **open-webui** (and LibreChat's Running group), not the RP apps.
3. **"Character.AI = one ongoing chat per character"** → many chats per character, latest resumed.
4. **"Group chats are a separate kind" is not universal.** ST: separate, solo→group one-way. Agnai:
   a solo chat simply gains members.
5. **The big agent-chat peers do NOT solve ISS-50.** open-webui replays other models' turns as plain
   `assistant`; LibreChat stamps the *current* agent's name on all of them. Name-prefixing is an
   RP-app (ST groups, Agnai) and open-webui-*Channels* practice.

---

## Implications for ctrl-b A15 (reading of the evidence — not a decision)

- **Past-conversations list:** open-webui's shape is the closest whole precedent for a server-owned,
  multi-device, concurrent-turn app: date sections + pinned + search; add what it lacks for a
  character app (avatar + last-message preview, per ST/Telegram rows).
- **Unread:** copy Telegram/open-webui — one **server-side per-thread read marker** (timestamp or
  last-message id) + an optional manual "unread" flag; unread ⇔ last activity > marker; broadcast the
  marker so the phone and desktop agree (A15 Q9). Backfill marker = `updated_at` on migration.
- **Running:** ctrl-b's turns registry already = open-webui's tasks; a row spinner (or LibreChat's
  hoisted "Running" group) needs only an event/poll, not new state.
- **Pick = open that agent's chat:** ST's "chat bound to the character" is the direct precedent; the
  bound/latest distinction (open-last-opened vs open-most-active) is a real choice to rule.
- **The hybrid has precedent but no toggle:** the clean shapes are *one-reply* (open-webui Channels
  `@model`, ST force-talk, Agnai pills), not a sticky responder swap. Whatever ships, earlier turns
  by another agent need **name attribution** (ST/Agnai `"Name: "` prefix or a system-side transcript)
  — that is what closes ISS-50; the big peers that skip it carry the bug.
- **Groups** are optional later: ST (separate kind) and Agnai (in-place members) are both viable.
- **390 px:** list-detail single pane with back → list (Android guidance); root-screen vs drawer vs
  tab is open (Telegram root, open-webui drawer, Discord tab).

## Not bought (gaps)

- Telegram typing re-send cadence/timeout and dialog sort rule (official pages fetched did not state them) [U].
- Discord read-state semantics (private API); LibreChat arrival notification for non-open chats [U].
- LibreChat / ST mobile layout read from source (drawer assumed for LibreChat) [U].
- Character.AI from primary sources (no public docs/source) — all [R].
- RisuAI multi-character chat model (not cloned this pass).
- Hermes gateway (Telegram/Slack) chat→session mapping [U].
- How open-webui renders `modelName` across a mid-chat switch in the transcript (R47 covers display generally).
