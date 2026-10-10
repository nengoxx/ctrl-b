import { useCallback, useRef, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";

import {
  filesFrom,
  offerFiles,
  primaryAcceptsImages,
  ATTACH_ACCEPT,
  ATTACH_PHOTO_ACCEPT,
} from "../lib/attachments";
import { useVerbsVersion } from "../lib/composer";
import { removeStaged, useStagedFiles, type StagedAttachment } from "../store/attachments";
import { getHomeMode } from "../store/chat";

// COMPOSER ATTACHMENTS, the React surface (D68 / ATTACHMENTS_PLAN §7).
//
// Headless like `useComposer()` itself: the three gestures (the clip's file input, a PASTE into the
// field, a DROP on the bar) all end in `lib/attachments#offerFiles`, and what a variant gets back is
// the staged set plus props to spread. One hook call per composer — the CHIPS and the CLIP are
// rendered by `AttachRail`/`AttachClip` from the controller this returns, so a variant never wires
// the pipeline twice and the three variants cannot drift apart.
//
// Deliberately NOT `useMediaUpload`'s shape (§1, council-confirmed): that hook is a consumer of the
// gallery's `useImageJob` MACHINE, whose whole subject — one admission at a time behind a latch, a
// crop step, a retryable two-phase delivery — is the opposite lifecycle from this one. Attachments
// are many files at once, each with its own outcome, and none of them is retried by a row.

/** The clip's two doors (ISS-47 ⓔ-images, owner-ruled 2026-10-06): PHOTOS asks for image types only,
 *  which on Android is Chrome's own grid picker (real file sizes, multi-select); FILES keeps the mixed
 *  list — the file-manager escape, and images MediaStore does not index. */
export type AttachDoor = "photos" | "files";

/** What each door sets on the ONE input before it opens it. */
const DOOR_ACCEPT: Record<AttachDoor, string> = {
  photos: ATTACH_PHOTO_ACCEPT,
  files: ATTACH_ACCEPT,
};

export interface AttachController {
  files: readonly StagedAttachment[];
  /** The picker — sets the door's `accept` on the hidden input the variant renders through
   *  `inputProps`, then opens it. */
  pick: (door: AttachDoor) => void;
  remove: (localId: string) => void;
  /** Spread onto the hidden `<input type="file">` the clip owns. NO `accept` here: `pick` sets it
   *  imperatively per door, and a static prop would have React re-assert one value over it. */
  inputProps: {
    ref: React.RefObject<HTMLInputElement | null>;
    type: "file";
    multiple: true;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  };
  /** Spread onto the composer ROOT (drop) and the textarea (paste) — the same entrance either way. */
  dropProps: {
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
    onPaste: (event: ClipboardEvent) => void;
  };
  /** The configured chain's primary cannot see images — the quiet per-chip hint (R62 steal). Purely
   *  informational: nothing here gates on it, and the server's in-band strip is the real floor. */
  imagesUnsupported: boolean;
}

export function useAttachments(): AttachController {
  const files = useStagedFiles();
  const inputRef = useRef<HTMLInputElement>(null);
  // The vision answer arrives on the SAME `/api/providers` read the composer's verbs do, so its
  // install is what re-renders this — the documented "publish a version, re-derive" pattern
  // (`lib/composer`'s `useVerbsVersion`), not a second query.
  useVerbsVersion();

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    // ALWAYS reset (R54 §5.4): `change` fires only when the SELECTION changes, so without this,
    // picking the same photo twice is a dead button — the second pick fires `cancel`, not `change`.
    event.target.value = "";
    void offerFiles(picked);
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    const picked = filesFrom(event.dataTransfer);
    if (picked.length === 0) return; // a text drag is the field's own business
    event.preventDefault();
    void offerFiles(picked);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    // Without a prevented dragover the browser never fires `drop` — and without the file test, a
    // dragged text selection would lose its own default too.
    if ([...(event.dataTransfer.items ?? [])].some((i) => i.kind === "file"))
      event.preventDefault();
  }, []);

  const onPaste = useCallback((event: ClipboardEvent) => {
    const picked = filesFrom(event.clipboardData);
    if (picked.length === 0) return; // ordinary text paste — leave it entirely alone
    event.preventDefault();
    void offerFiles(picked);
  }, []);

  return {
    files,
    // ONE input, two filters — the card import's `pickCard(accept)` precedent (AgentsTab): what a door
    // must decide is `accept` AT THE MOMENT the chooser opens, so it is written then, never rendered.
    pick: (door) => {
      const input = inputRef.current;
      if (!input) return;
      input.accept = DOOR_ACCEPT[door];
      input.click();
    },
    remove: removeStaged,
    inputProps: { ref: inputRef, type: "file", multiple: true, onChange },
    dropProps: { onDragOver, onDrop, onPaste },
    // Only ever claimed about the CONFIGURED chain: with the home's sticky `/<provider>` in force the model
    // that will serve is resolved server-side and is not in this payload, so the honest answer is to
    // say nothing rather than warn about a model that is not the one being used.
    imagesUnsupported: getHomeMode() === null && !primaryAcceptsImages(),
  };
}
