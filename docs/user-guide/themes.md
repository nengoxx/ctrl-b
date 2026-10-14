# Themes, appearance and the app

ctrl-b ships five themes. **Cosmos** is the default. A theme changes more than colours: some redraw the
fleet completely, and every theme comes with its own options. The rest of **Conf → Appearance** holds
switches that apply across themes, such as motion, blur, the app bar, how many tabs the bar shows, and
the composer's look. Some of these follow you to every device and some stay on the device you set them
on. This page also covers installing ctrl-b as an app on your phone, how updates arrive, and what works
offline.

## How to use it

### Pick a theme

Open **Conf → Appearance → Theme** and tap one. The switch animates, or happens instantly with Motion
reduced. Switching theme resets **Mode** and **Palette** to that theme's defaults. Each theme remembers
its own options, so they are still there when you come back to it.

| Theme | What it looks like | Modes | Palettes (default first) | Tab bar by default |
|---|---|---|---|---|
| **Cosmos** (default) | Deep space. The fleet is an orbital system: each machine is a planet with moons. | dark | Violet · Cyan · Green · Amber | 4 tabs |
| **Vapor** | Vaporwave, with an animated sun-and-grid hero over the fleet. | dark | Vapor · Aqua · Ember | 4 tabs |
| **Minimal** | A calm, plain skin over the standard layout, with one quiet accent. | dark · light | Cyan · Moss · Iris · Amber | 4 tabs |
| **Frontier** | A badlands comic western. The fleet is a map, and chat has a floating rig stack. Its tabs read *frontier · comms · tools · settings · cast*. | dark (night) · light (day) | Coral · Amber · Magenta · Violet | 3 tabs |
| **Gacha** | A capsule-arcade prize parlour, with a pickup banner, capsule cards and a unit dossier. Its tabs carry Japanese sub-labels. | dark | Arcade · Midnight · Indigo · Ember · Glacier · Nebula · Eridu · Jade | 3 tabs |

The **Mode** row only appears for themes that have both modes (minimal and frontier). Vapor, cosmos
and gacha are dark-only.

### Each theme's own options

These rows appear under the theme picker for the active theme:

- **Cosmos**: **Moon** (Cutout · Carved, the central body's style) · **Service banners** (decorative art
  behind the service rows of a machine's sheet) · **Motion speed** (Calm · Normal · Lively) · **Orbit**
  (Per-planet · Rigid · Off) · **Liveness**, the online indicator (Pulse · Halo · Both · Off) · **Service
  cue** (Data · Visual · Off), how a planet shows its services through its moons, ring and size.
- **Vapor**: **App mark** (Logo · Ring) · **Sun & grid** (the animated hero scene) · **Horizon** (City ·
  Mountains) · **Live waveform** (a ping graph on the hero).
- **Minimal**: **Density** (Comfortable · Compact).
- **Frontier**: only the shared composer and outline options below.
- **Gacha**: **Dossier** (the unit dossier's surface: Slip, Neon, Sunset, Rose, Aurora, Teal, Forest,
  Blue) · **Name face** and **Card face** (Mincho · Bungee · Zen Maru) · **Fleet layout** (**Capsule** ·
  **Poster** · **Cover**, three different ways to present your machines; Cover pairs best with the app
  bar hidden) · **Poster name** (Plate · Blade, shown only while Fleet layout is Poster) · **Stars**
  (5★ · 3★) · **Pickup banner** (On · Minimal · Off) · **Banner wallpaper** (pickup art fills the fleet
  background) · **Sticky operator art** (the agent header fades in place instead of scrolling away).

### The composer's look

Every theme also offers four shared rows. Their defaults differ per theme:

- **Composer**: the input bar's layout, **Stacked**, **Docked** or **Line**.
- **Composer skin**: the chrome of the input bar and its panels, **Outline**, **Glass**, **Bezel**,
  **Sleek** or **Arcade**.
- **Plan**: where the agent's task plan sits, **Inline** in the chat or **Pinned** as a head that
  stays in view.
- **Outlines**: resting borders on the chat surfaces.

| Theme | Composer | Skin | Plan | Outlines |
|---|---|---|---|---|
| Cosmos | Stacked | Outline | Inline | on |
| Vapor | Docked | Outline | Pinned | on |
| Minimal | Stacked | Outline | Inline | on |
| Frontier | Stacked | Bezel | Inline | off |
| Gacha | Stacked | Arcade | Inline | off |

### Switches for every theme

- **Motion**: ambient effects (LED pulses, the equalizer, the sun bob). Off is "reduced". On a fresh
  device it starts from your system's *reduce motion* setting, once. After that your choice wins.
- **Blur**: frosted-glass bars. Turning it off gives opaque bars, which are faster, especially on
  Firefox.
- **Shared background**: paints your picture from **Shared art → Background** (see [Media](media.md))
  behind the app. A theme with its own scenery uses the picture on its own backdrop, under its own switch.
- **Chat avatars**: an agent's picture leads its replies. Off keeps a plain dot.
- **Agent backdrop**: where the active agent's backdrop paints: **Operator** (a strip), **Full** (behind
  the chat) or **Off**.
- **Bar subtitle**: shows the theme's own subtitle beside the title. A theme without one shows nothing.
- **App bar**: **On** · **Clear** (a transparent bar) · **Off** (more screen, tab bar only) · **Min** (no
  app bar and no tab bar; you get around through the orbit menu).
- **Layout**: how many sections sit on the tab bar, **Auto**, **4**, **3** or **2**. **Auto** uses the
  theme's own default (see the theme table). On **3**, Tools moves into Conf as a group. On **2**, Conf
  also moves into the nav menu.
- **Agents**: where the character gallery lives. **Conf** (the default) makes it a group inside Conf,
  **Button** puts it in the nav menu, and **Tab** gives it its own seat on the bar.
- **App icon backdrop**: the background baked into the installed home-screen icon (**Clear** · **Ink** ·
  **Night** · **Orchid** · **Paper**). Chrome picks it up the next time it refreshes the installed app;
  approve it under the app's ⋮ menu if asked, or uninstall and re-add the app to apply it at once.
  Firefox bakes the icon at install and never updates it.

Appearance changes apply at once, with no Save button.

### What follows you, and what stays on this device

| Synced to all your devices (stored on the server) | Kept on this device only (stored in the browser) |
|---|---|
| Theme · Mode · Palette · each theme's own options (including the composer rows) · Motion · Blur · Shared background · Bar subtitle · Chat avatars · Agent backdrop · App icon backdrop | App bar · Layout · Agents placement · auto read-aloud (the app-bar speaker) · the section you were last on · which Conf groups are open |

When two devices change synced settings, the later change wins. The app reopens on the section you
last used.

### Install ctrl-b on your phone

1. Open the **HTTPS** address (`https://<host>.<tailnet>.ts.net`, set up in [Getting
   started](getting-started.md)).
2. Use the browser's menu: **Install app** or **Add to Home screen**. ctrl-b shows no install prompt of
   its own.

The installed app opens full-screen with a dark splash, whatever theme you use. It can only be installed,
work offline and update itself on the HTTPS address. The plain `http://<host>:5433` address works as a
web page, but none of those three.

### Updates

After a new release is installed on the server, the next time the app loads it fetches the new version
and shows a sticky **"// new version available"** notice with **refresh**. Tapping **refresh** reloads
every open ctrl-b tab onto the new version. If you dismiss it, the old version keeps running, and the
new one takes over once every ctrl-b window has been closed.

Nothing checks for updates in the background. An app you leave open sees a release only when it is
reloaded or reopened.

### Offline

The app's own files, its fonts and the media pictures you have already viewed are cached on the device.
Offline, the app still opens and keeps your theme. Everything live (fleet status, chat, settings) needs
the server. The app bar shows **offline**, or **reconnecting**, until the live feed returns. Appearance
changes made offline are sent when you reconnect.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`appearance.theme` / `mode` / `accent`](configuration-reference.md#appearance) | Theme, Mode and Palette. | cosmos / dark / violet | live, synced |
| [`appearance.theme_settings`](configuration-reference.md#appearance) | Each theme's own options and its composer rows, kept per theme. | the theme's defaults | live, synced |
| [`appearance.motion` / `perf`](configuration-reference.md#appearance) | Motion (full · reduced) and Blur (full · lite). | from the system once / full | live, synced |
| [`appearance.kit_background_visible`](configuration-reference.md#appearance) | Shared background. | on | live, synced |
| [`appearance.appbar_subtitle_visible`](configuration-reference.md#appearance) | Bar subtitle. | off | live, synced |
| [`appearance.chat_avatars_visible`](configuration-reference.md#appearance) | Chat avatars. | on | live, synced |
| [`appearance.agent_backdrop`](configuration-reference.md#appearance) | Agent backdrop (operator · full · off). | operator | live, synced |
| [`appearance.pwa_icon_background`](configuration-reference.md#appearance) | App icon backdrop. | clear | when the browser refreshes the installed app |
| **App bar** · **Layout** · **Agents** placement | The bar and navigation shape. | On · Auto · Conf | live, this device only (not in `config.yaml`) |

The `appearance:` block in `config.yaml` is written by the app. You don't need to edit it by hand.

## Edge cases & limits

- **A theme switch is refused while you have unsaved edits.** Anywhere in the app, unsaved edits block it:
  *"Save or discard your unsaved changes before switching theme"*. A theme change made on another device
  waits on this one until you save or discard.
- **A theme that crashes can be reset from inside the app.** Its error screen (*"the theme crashed"*)
  offers **Reload page** and **Reset theme to default**. The reset switches to cosmos and syncs the
  switch.
- **A theme's own art is managed only while it is active.** Gacha's and frontier's media groups appear
  in Conf only under that theme (see [Media](media.md)).
- **A broken stored theme falls back to cosmos.** If the device remembers a theme this build doesn't
  have, the app starts in cosmos.
- **Android Back closes the top sheet, gallery, crop or confirm dialog** instead of leaving the app. During
  a call it hangs up.
- **Leaving with unsaved edits** asks you to confirm first.
- **The installed icon on iOS** uses a fixed icon. The App icon backdrop choice does not apply there.
- **No install, offline mode or update notice on plain HTTP**, and none on the Vite development server
  (port 5173).

## Under the hood

Design: [`docs/THEME_ENGINE.md`](../THEME_ENGINE.md)
