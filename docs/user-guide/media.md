# Media: your own art

ctrl-b can wear your own pictures: service icons and banners, machine pictures, an app-wide background,
a logo, agent avatars and backdrops, and the art of the themes that have their own (gacha and frontier).
Each place a picture can go is a **destination**, and each destination has a **library**. The library
holds your uploads and the art that ships with the app, in one ordered list. **The order decides what
shows.** You manage the libraries from Conf. You can also copy files into their folders over SSH.

## How to use it

### Where to find it

Open **Conf** and scroll to the bottom. Below **Appearance** there is one group per art collection:

| Group | Folder | What its destinations are for |
|---|---|---|
| **Shared art** (always shown) | `media/kit/` | **Service icons** (one per service, named after its kind, else its name) · **Service banners** (the wide art behind a service row, named like its icon; under cosmos there is also a **Built-in rotation** of banners) · **Machine pictures** (one per machine, named after it, painted faded behind that machine's detail sheet by the themes that use it) · **Background** (one picture behind the whole app) · **Logo** (beside the app title; only its shape is used, tinted with the theme's accent) |
| **Agent art** (always shown) | `media/agents/` | **Avatars** (portraits your agents choose from in their editor) · **Backdrops** (the picture behind the chat while an agent is active). Nothing here is used until an agent is given one. |
| **Theme art**, gacha (only while gacha is the theme) | `media/gacha/` | **Characters** (the cast: machine cards, portraits and promo slides) · **Banner slides** (the pickup banner, first slide first) · **Transition figure** (the cutout that sweeps across on tab changes) · **Operator backdrop** (behind the agent operator block) · two seats, **Fleet backdrop** and **Operator character**, which each bind one character |
| **Theme art**, frontier (only while frontier is the theme) | `media/frontier/` | **Rig cards** (dealt to machines in order) · **Map cover** · **Comms stack** (three named layers of one floating composition) |

A theme's own art can only be managed while that theme is active. Switch theme in **Conf → Appearance**
to reach the other one. Every folder above lives under your data home, `$CTRLB_HOME/media/`.

Each destination is a **card**. Tap it to open its full-screen gallery. Android Back, ✕ or Escape
closes it.

### Add a picture

1. Open the destination's gallery and tap **Add an image**. On desktop you can also drop a file on the
   gallery or paste an image.
2. **Frame the image**: pick a shape (**Original**, 1:1, 4:3, 3:4, 16:9, 9:16, or **Fit here** for this
   destination's own shape), drag to move, and pinch or use **Zoom** (up to 4×). Choose **Use this crop**,
   or **Use as is** if you didn't change anything.
3. The picture is re-encoded on your device before it uploads. Its EXIF and GPS data are stripped on
   the way.
4. It lands at the **end** of the library. In a destination that uses only its first image, move it to
   the top to make it live (see below).

Names are picked for you. A name that already exists gets `-2`, `-3`, … added, and you never see a
"file exists" dialog.

**What is accepted:** PNG, JPEG and WebP, up to **15 MB** per file (`media.write.max_bytes`). The app
refuses pictures over **64 megapixels** before it tries to decode them. A 48 MP phone photo
(8000×6000) fits. HEIC, TIFF and SVG are refused with a sentence that says what to do instead. For
HEIC: switch the camera to JPEG, or share the photo, since sharing converts it.

### Arrange the library: which image is live

The library's order is its priority. There is no separate "set as active" button.

- **Pool destinations** (Background, Logo, Transition figure, Map cover, Operator backdrop and the
  like) use the **first image in use**. Lists that deal art out (Characters, Banner slides, Rig cards,
  the cosmos banner rotation) use every image in use, in order.
- **Named destinations** (Service icons, Service banners, Machine pictures, the frontier Comms stack)
  bind a file to a service, a machine or a layer **by its name** (`jellyfin.png` belongs to the service
  of kind `jellyfin`). If two files answer to the same name, the one higher in the list wins. Files that
  match no name collect in an **Unassigned** card.
- **Seats** (gacha's **Fleet backdrop** and **Operator character**) bind one character. Open a character
  and tap **Use here**, or **Clear** to unbind it.
- **In use**: the switch on a tile's corner, or in the picture's detail, takes a picture out of play
  without deleting it.

To reorder, **press and hold a tile for half a second** and drag it (on desktop, drag it directly). You
can also open a picture and use **Top**, **Up**, **Down** or **Bottom**. If a move fails, the tile snaps
back.

**Restore defaults** (on sections that ship art) puts the app's own images back on top, in use and in
their original order. Your own images stay in the library, switched off. Nothing is deleted.

### Focus point and editing

Open a picture to see its detail panel:

- **Focus** (*set* / *not set*) opens **Set focus**. You place the point that must stay visible and can
  zoom in. Previews show how each place the picture is used would crop it ("Previews are examples").
  If the file changes later, the point no longer fits, so it resets: *"Focus was reset — the file
  changed."*
- **Edit image** (the pencil button) re-crops the stored picture and saves it under the same name.
  The picture keeps its place, its In-use state and its binding.
- **Delete** removes the file from the server and cannot be undone. If it was the live image, the next
  one in the list takes over. The app's bundled art cannot be deleted, only switched off.

### Copying files in over SSH

You can skip the app and copy files straight into the folders, for example
`$CTRLB_HOME/media/kit/services/jellyfin.png` or `$CTRLB_HOME/media/kit/hosts/<machine-name>.png`.
Natural sort order applies to files you have not arranged in the app, so `01-foo`, `02-bar` sort the
way you expect. Renaming a machine leaves its old picture unmatched. Rename the file to match.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`media.write.max_bytes`](configuration-reference.md#mediawrite) | The largest file one upload may be, checked by the server as it streams. There is no Conf form. | 15 MB | live (API); a hand edit of `config.yaml` needs a restart |
| [`media.namespaces.<ns>.roles.<role>.files`](configuration-reference.md#medianamespaces) | The library order, In use, focus points and name bindings. Written by the gallery; you rarely edit it by hand. | empty (bundled order) | live |
| **Shared background** ([`appearance`](configuration-reference.md#appearance)) | Whether the shared Background picture paints. Themes with scenery of their own paint it on their own backdrop, under their own switch. | on | live, synced to all your devices |
| **Agent backdrop** / **Chat avatars** ([`appearance`](configuration-reference.md#appearance)) | Where an agent's backdrop paints (operator strip · full · off), and whether replies lead with the agent's avatar. | operator / on | live, synced |

## Edge cases & limits

- **A replaced picture can look stale once.** Pictures are cached on your device so the app works
  offline. A picture you replace under the same name, for example over SSH, is shown from the cache first
  and refreshed in the background, so the new one appears on the next view. A file you copy in shows up
  in the gallery the next time you enter Conf, which re-reads the folders each time. Elsewhere in the
  app it appears once the listing refreshes: entering Conf refreshes it everywhere, and otherwise
  theme art refreshes when you come back to the app more than a minute later, and the shared art after
  ten minutes, or when you reload the app.
- **"Empty" files from the Android picker.** Android's generic file picker sometimes reports a real photo
  as 0 bytes, and the app then says *"this device reported that file as empty"*. Pick it again from the
  photo grid or through a file manager. See [ISS-47](../ISSUES.md).
- **The 64 MP limit and the metadata strip are the app's, not the server's.** A file copied in over SSH,
  or uploaded with `curl`, is stored exactly as sent: any pixel count under the byte cap, with its EXIF and
  GPS data intact. Your tailnet is then served that file as it is.
- **Two devices editing at once.** Gallery changes are saved one at a time from each device. If two
  devices rearrange the same library at the same moment, the last save wins. If you edit a picture that
  another device changed meanwhile, the save is refused: *"the picture changed on the server — reopen it
  and try again"*.
- **A broken folder disables its collection.** If a media folder is a symlink, or a file sits where a
  folder belongs, that collection is disabled until the server restarts, and its group says so.
- **Only PNG, JPEG and WebP are ever listed or served.** Other files in the folders are ignored.

## Under the hood

Design: [`docs/MEDIA_MANAGER_PLAN.md`](../MEDIA_MANAGER_PLAN.md) (writes, libraries, the gallery) · [`docs/MEDIA_PLAN.md`](../MEDIA_PLAN.md) (namespaces, roles, serving)
