import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, getJSON, getJSONWithHeader, putJSON } from "../api/client";
import { loadAgents, loadProviders } from "../lib/composer";
import { pushToast } from "../store/toast";
import type { McpServer, OpenApiServer } from "./useIntegrations";
import type { NotificationEvents } from "./useNotificationPrefs";
import { withEventDefaults } from "./useNotificationPrefs";
import { useScopedQuery } from "./useScopedQuery";

// Phase 7a. The settings doc is the whole masked config; the Conf forms read/write the slices they
// expose (server + inference here). Typed loosely — only the edited groups are modelled; the rest
// round-trips opaquely so a partial PUT never has to mirror the entire backend Settings shape.

// A11 / D48 — the unified provider registry. `providers` is the ONE top-level map of connections, each
// carrying a name-keyed model catalog; every consumer section (inference here, voice/embeddings in
// Slice 2) points at a provider + model via a flat `{provider, model?}` ref. Wire dialect + max_tokens
// derivation stay on the provider (D45/D46). Voice/embeddings keep their legacy shape until Slice 2.

/** One catalog model. KEY (in `ProviderDoc.models`) is the clean display name; `id` defaults to the
 *  key. Role-scoped fields (voice/speed/language/format/dim) are schema-complete now but only consumed
 *  from Slice 2 on; any extra key round-trips unharmed. */
export interface ModelDoc {
  id?: string | null; // wire model id (defaults to the map key when unset/equal)
  context_window?: number | null; // D42 — chat window; null = auto (probe / threshold fallback)
  max_tokens_field?: "max_tokens" | "max_completion_tokens" | null; // C6 model-level override (chat)
  extra_body?: Record<string, unknown> | null; // chat-call passthrough (model-level home)
  dim?: number | null; // embeddings-scoped
  voice?: string | null; // TTS-scoped
  speed?: number | null; // TTS-scoped
  language?: string | null; // STT-scoped
  format?: string | null; // TTS-scoped
  [k: string]: unknown; // preserve any extra fields verbatim on round-trip
}

/** One provider connection + its model catalog. `api_key` masks on read (blank-keeps on PUT). */
export interface ProviderDoc {
  base_url: string;
  api_key: string | null; // masked on read; echo unchanged to keep the stored secret
  api_mode: "openai" | "llamacpp" | "openrouter" | "none";
  max_concurrent_requests?: number | null; // SERVER capacity (D40 semaphore keys here)
  retry_attempts?: number | null; // provider > global override
  max_tokens_field?: "max_tokens" | "max_completion_tokens" | null; // derived from api_mode when null
  models: Record<string, ModelDoc>;
  [k: string]: unknown; // preserve any extra fields verbatim on round-trip
}

/** A flat pointer into the registry: a provider + (optional, sole-model-omittable) clean model name. */
export interface SectionRef {
  provider: string;
  model: string | null;
}

/** A consumer section's resolved primary + fallbacks, as reported by `GET /api/providers`. */
export interface EffectiveChain {
  provider: string | null;
  model: string | null;
  fallbacks: { provider: string; model: string | null }[];
}

// Voice (Phase 6; A11/D48 Slice 2) — one STT + one TTS service, each pointing at the top-level
// `providers` registry via a flat `provider` primary (+ optional `model`) and an ordered `fallbacks`
// list of `SectionRef` (voice chains always walk — there is deliberately no failover toggle). The
// legacy `primary`/`fallback` endpoint slots (base_url/api_key/model on the section) are RETIRED —
// connection details + the voice/language/format live on the referenced provider/model.
interface VoiceServiceCommon {
  provider: string | null; // primary provider name; null → that service unconfigured
  model: string | null; // omittable iff the provider's catalog has exactly one model
  fallbacks: SectionRef[]; // ordered N-deep failover chain after the primary
  connect_timeout_s: number; // fail-fast on an unreachable endpoint → fall over
  timeout_s: number; // read window for the transcription/synthesis
  extra_body: Record<string, unknown>; // advanced passthrough (round-trips even without a UI control)
}
export interface VoiceStt extends VoiceServiceCommon {
  language: string; // "" → auto-detect
  vad_filter: boolean; // skip silence
  hotwords: string; // space-separated recognition bias
  auto_send: boolean; // true → mic sends the transcript; false (default) → fill composer for review
}
export interface VoiceTts extends VoiceServiceCommon {
  format: string; // response_format/container (mp3 = universally seekable)
}

export interface SettingsDoc {
  server: {
    host: string;
    port: number;
    poll_seconds: number;
    feature_cycle_seconds: number;
    debug: boolean;
  };
  // A11 / D48 — the top-level connection registry (full card shape incl. base_url + masked api_key).
  providers: Record<string, ProviderDoc>;
  inference: {
    // Flat primary + ordered fallbacks (D48). Provider primary; model omittable iff the provider's
    // catalog has exactly one model. `default_mode` / local / cloud slots are RETIRED.
    provider: string | null;
    model: string | null;
    fallbacks: SectionRef[];
    request_timeout_s: number;
    system_prompt: string;
    system_prompt_append: string; // 7e-a additive axis — appended as its own system message
    failover: boolean; // walk the primary→fallbacks chain on failure
    retry_attempts?: number | null; // global retry (provider override wins); round-trips, no UI here
  };
  // Integration endpoints (Phase 7c-a) — scalar configs edited through this same settings PUT.
  searxng: { base_url: string; enabled: boolean; language: string | null };
  // A11/D48 Slice 2 — embeddings points at the `providers` registry (flat primary + ordered fallbacks)
  // and gains failover for free. The connection + the vector `dim` (per-model) are RETIRED from here.
  embeddings: {
    provider: string | null;
    model: string | null;
    fallbacks: SectionRef[];
    enabled: boolean;
    timeout_s: number; // section-level SDK read window
  };
  open_terminal: {
    base_url: string;
    api_key: string | null; // masked on read
    enabled: boolean;
    exec_risk: string;
    write_risk: string;
    read_risk: string;
  };
  // Guarded local shell (Phase 5) — the `!<cmd>` escape hatch + the agent's run_shell gate.
  shell: {
    enabled: boolean;
    user_exec_enabled: boolean;
    agent_exec_enabled: boolean;
    workdir: string;
    timeout_s: number;
    max_output_chars: number;
  };
  voice: { enabled: boolean; stt: VoiceStt; tts: VoiceTts };
  // F1 — foreground notification preferences. Same shape as the always-on `GET /api/notifications`
  // read (`useNotificationPrefs`); edited here through the ordinary settings draft/PUT, since there
  // is exactly one write path for config.
  notifications: { enabled: boolean; events: NotificationEvents };
  // D2-A / D50 — the backend's own monitor loop (`MonitorCfg`): the master switch, the tick interval
  // (cross-field validated `>= server.poll_seconds`, which is why the Conf rows sit in ONE group with
  // it) and the asymmetric consecutive-check damping.
  monitor: {
    enabled: boolean;
    poll_seconds: number;
    down_after_checks: number;
    up_after_checks: number;
  };
  // ROADMAP D2 / D50 — fleet wake automation (`WakeCfg`): BOTH triggers' global tunables on the one
  // object (never a sibling `presence:` map). `cooldown_s` is the shared automatic-wake floor;
  // the `presence_*` fields are the D2-A owner-device edge's half.
  wake: {
    cooldown_s: number;
    presence_device_ips: string[];
    presence_offline_after_s: number;
    presence_cooldown_s: number;
    tailscale_socket_path: string;
  };
  mcp_servers: McpServer[]; // Phase 7c-b — managed via the integrations CRUD endpoints, read here
  openapi_servers: OpenApiServer[];
  [k: string]: unknown; // other sections (agent, …) — managed elsewhere
}

export interface SaveResult {
  settings: SettingsDoc;
  restart_required: string[];
  warnings: string[]; // D48 C9 — non-fatal notices (skill shadows, catalog hazards); render inline
  providers_rev: string; // D48 C2 — post-write providers fingerprint (the next PUT's base)
}

/** The settings PUT payload: a partial doc plus the two D48 transport siblings. `provider_renames`
 *  + `providers_base` are stripped server-side (never persisted); `providers_base` MUST accompany any
 *  `providers` map (even unchanged) so a concurrent full-map replacement can 409 instead of clobbering. */
export interface SavePatch {
  [k: string]: unknown;
  provider_renames?: Record<string, string>;
  providers_base?: string;
}

/** The naked, non-secret provider view (GET /api/providers) — the composer's `/<provider>` source +
 *  the Conf/AgentsEditor pickers' catalog + the boot/lenient warnings. NO api_key, NO base_url. */
export interface ProvidersInfo {
  providers: Record<string, { api_mode: string; models: string[] }>;
  rev: string; // providers fingerprint (informational here; the Conf PUT base rides GET /api/settings — FR2-1)
  // A11/D48 — the effective (resolved) chain per consumer section. Slice 2 adds stt/tts/embeddings
  // beside inference; the Conf editors drive the DRAFT settings, so these are informational here.
  sections: {
    inference: EffectiveChain;
    stt: EffectiveChain;
    tts: EffectiveChain;
    embeddings: EffectiveChain;
  };
  reserved_verbs: string[];
  verbs: string[]; // composer-routable provider names
  warnings: string[];
}

/** Full config (secrets masked). Conf-only data — scoped to the Conf tab so we don't fetch while
 *  the user is on Fleet/Agent. Re-entry to Conf force-refreshes (refetchOnMount: 'always' inside
 *  useScopedQuery), so the cache stays fresh whenever the user actually looks at it. */
export function useSettings() {
  const qc = useQueryClient();
  return useScopedQuery<SettingsDoc>("conf", {
    queryKey: ["settings"],
    queryFn: async ({ signal }) => {
      // FR2-1 — read the providers fingerprint off the SAME response (the `X-Providers-Rev` header) and
      // stash it under ["settings","providers-rev"] so the Conf draft can bind its concurrency base to the
      // exact settings snapshot it seeds from. ONE request; the doc body stays the query data (C9 naked).
      // Pass TanStack's `signal` so a save's `cancelQueries(["settings"])` aborts this read BEFORE the
      // setQueryData below — otherwise a slow read landing after the PUT echo overwrites the fresh
      // post-save rev with its stale one (Codex). The rejection on abort guarantees the ordering; no
      // manual `signal.aborted` check is needed.
      const { data, header } = await getJSONWithHeader<SettingsDoc>(
        "/api/settings",
        "X-Providers-Rev",
        { signal },
      );
      qc.setQueryData(["settings", "providers-rev"], header);
      return data;
    },
    staleTime: 30_000,
  });
}

/** The providers fingerprint that rode in on the last `GET /api/settings` (its `X-Providers-Rev`
 *  header, stashed by `useSettings`). This is the Conf draft's concurrency base — bound to the SAME
 *  snapshot the draft seeds from, NOT the independently-fetched `useProviders().rev` (FR2-1, closing the
 *  read-skew). A read-only cache subscription: it never fetches (the settings queryFn + a save populate
 *  the key); it re-renders consumers when either does. */
export function useSettingsProvidersRev(): string | null {
  const { data } = useQuery<string | null>({
    queryKey: ["settings", "providers-rev"],
    queryFn: () => null, // never runs (enabled:false) — the key is written by useSettings/useSaveSettings
    enabled: false,
    staleTime: Infinity,
  });
  return data ?? null;
}

/** The provider registry view (D48). Conf-scoped like useSettings — consumed by the Providers +
 *  Inference sections (pickers, warnings, base rev) and the AgentsEditor picker. The composer keeps
 *  its own module-level `knownProviders` (refreshed on save), so verbs work from any tab. */
export function useProviders() {
  return useScopedQuery<ProvidersInfo>("conf", {
    queryKey: ["providers"],
    queryFn: () => getJSON<ProvidersInfo>("/api/providers"),
    staleTime: 30_000,
  });
}

/** How long a settings save will wait for the media index to re-read before giving up on it (W4).
 *  Generous for a LAN round trip and short enough that a hung fetch is a hiccup rather than a stuck
 *  Save button. Retire this bound when the kit grows a global request timeout. */
const MEDIA_REFETCH_TIMEOUT_MS = 5_000;

/** Save a partial settings patch. Invalidates the cache + toasts; surfaces a restart note. */
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SavePatch) => putJSON<SaveResult>("/api/settings", patch),
    // Cancel any in-flight settings GET before writing. Without this a read that started BEFORE the
    // save can land after `setQueryData` and restore the pre-save doc + its old `X-Providers-Rev`; a
    // draft that just went clean then reseeds from that stale snapshot and shows old values while the
    // server holds the new ones — with the bar saying "Saved" (Codex, review of the fix wave). This is
    // the standard optimistic-write guard; it is the one thing missing to make the echo authoritative.
    onMutate: () => qc.cancelQueries({ queryKey: ["settings"] }),
    onSuccess: async (res) => {
      qc.setQueryData(["settings"], res.settings); // adopt the server's masked echo immediately
      // FR2-1 — keep the providers base rev PAIRED with the settings echo (the same key the settings
      // queryFn writes), so a follow-up save's epoch capture reads the fresh post-write base even before
      // the providers refetch resolves. The base is sourced from the settings snapshot, not ["providers"].
      qc.setQueryData(["settings", "providers-rev"], res.providers_rev);
      void qc.invalidateQueries({ queryKey: ["health"] }); // poll cadence/port may have changed
      void qc.invalidateQueries({ queryKey: ["voice-status"] }); // a Voice edit flips mic/TTS availability (6b)
      // F1 (Codex MED-2) — adopt the notification prefs from the PUT's own settings echo, exactly like
      // the settings doc above. The invalidation alone only *requests* a refetch: the engine keeps
      // gating on the pre-save preference for a whole extra round-trip, so a signal published in that
      // window is judged against the preference the owner just changed — the "I turned it off and it
      // still buzzed" shape, from the one place a stale read is unforgivable. The echo IS the
      // authoritative post-write doc (`mask_secrets(new.model_dump())`, the same body
      // `GET /api/notifications` reads from), so writing it makes the switch effective the instant the
      // save returns. The invalidation stays as the refetch backstop.
      //
      // Known residual (owner-declined: no polling, no SSE-driven invalidation): this fixes the device
      // that saved. ANOTHER open device keeps its cached prefs until its next refetch trigger.
      qc.setQueryData(["notification-prefs"], withEventDefaults(res.settings.notifications));
      void qc.invalidateQueries({ queryKey: ["notification-prefs"] });
      void qc.invalidateQueries({ queryKey: ["providers"] }); // D48 — a save may add/rename/drop providers (fresh names/warnings)
      void loadProviders(); // refresh the composer's module-level `/<provider>` verb set (best-effort)
      void loadAgents(); // SYS-9.2 — a save may change the default-agent selection; keep the composer's `/agent` set + resolved default fresh (best-effort)
      if (res.restart_required.length) {
        pushToast(`Saved · restart to apply: ${res.restart_required.join(", ")}`, "info");
      } else {
        pushToast("Settings saved", "ok");
      }
      // D52/G5 — a `media.<ns>` save changes the ORDER the media index serves (and its slot pins), and
      // the index is where the theme reads its art from. Invalidated by PREFIX so every namespace's
      // listing re-reads; the theme then repaints without a reload. Not `setQueryData`: the echo is the
      // settings doc, and the index is a projection of settings OVER THE FILES ON DISK — only the server
      // can compute it.
      //
      // AWAITED, and last (Codex F5). Everything above is fire-and-forget because its consumers can
      // tolerate one stale render; the media index cannot, because the GALLERY COMPUTES ITS NEXT WRITE
      // FROM IT. `isPending` stays true until the refetch lands, so the reorder controls stay blocked
      // until the authoritative order is the one on screen — otherwise a second tap between "PUT
      // resolved" and "index refetched" computes a full order from the stale list and persists it over
      // the first move. The toast fires BEFORE the await: the save really is done, and the extra tick is
      // about what the owner is allowed to click next, not about what the server knows.
      //
      // Cost when no media query is mounted (every non-gacha save): `invalidateQueries` only awaits
      // ACTIVE observers, so it resolves immediately.
      //
      // BOUNDED (Codex W4). `getJSON` has no timeout or abort — a standing kit-wide gap, not this
      // slice's to close — so a refetch that never settles would otherwise hold EVERY settings save
      // open forever, over an art listing. On the bound the save resolves and the gallery's move-block
      // simply ends with a possibly-stale order; the race F5 closed is the NORMAL path, where the
      // refetch lands in milliseconds on a LAN, and that path still waits for the fresh order.
      await Promise.race([
        qc.invalidateQueries({ queryKey: ["media"] }),
        new Promise((resolve) => setTimeout(resolve, MEDIA_REFETCH_TIMEOUT_MS)),
      ]);
    },
    onError: (e: Error, patch) => {
      // FX15 (Codex#12): the providers-conflict path applies ONLY to a 409 whose patch actually carried
      // the `providers` map (a full-map replacement conflict). The agent-busy 409 (a tool_overrides save
      // mid-turn) and every other error keep the generic toast with their own detail message.
      if (e instanceof ApiError && e.status === 409 && "providers" in patch) {
        // FX11 (Codex#3): the Conf draft holds the epoch-captured providers base, which does NOT advance
        // while the draft is dirty — so a blind retry keeps 409ing (no silent clobber of a concurrent
        // addition) until the user reloads/navigates and the draft reseeds clean at the fresh base.
        pushToast("Providers changed elsewhere — reload the tab to pick up the new state", "err");
        return;
      }
      pushToast(e.message || "Save failed", "err");
    },
  });
}
