"""OpenAI-compatible chat inference (DESIGN §7, RESEARCH "LLM backends").

One `AsyncOpenAI` client shape covers every backend — local llama.cpp and cloud differ only by
`base_url`/`api_key`/`model`. Clients are built lazily per base_url and cached. `stream_chat` yields
typed `ChatDelta`s so the agent loop stays agnostic of the SDK: `text` is answer content, `reasoning`
is a thinking model's chain-of-thought (llama.cpp exposes it as `reasoning_content`), streamed
separately so the UI can render it dimmed without polluting the saved answer.

Failover (D18): a request's selected endpoint delegates to an ordered chain (`config.endpoint_chain`)
on **any** error — the selected endpoint, then the other of local/cloud, then `inference.fallbacks`.
Streaming fails over at **initiation only** (the industry-standard "confirm the provider is alive with
a first token before committing"): `stream_chat` opens the stream + pulls the first chunk per endpoint;
once a chunk arrives we're committed (a mid-stream drop is a clean error, never a jarring restart). The
model override (an agent's `ModelRef.model`) applies to the *selected* endpoint only — fallbacks use
their own model (a local model id won't exist on a cloud backend). All reuses `core/failover.py`.

Failures (backend down, slow load timeout, auth, all-endpoints-failed) raise `InferenceError` — the
session boundary turns it into a clean SSE `error` event + an `ErrorPart`, never a stack trace.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING, Any, AsyncIterator, Literal, cast
from urllib.parse import urlsplit

import anyio
import httpx
from openai import AsyncOpenAI

from app.config import InferenceCfg, InferenceEndpointCfg
from app.core.failover import (
    NEXT_HOP,
    RETRY_AFTER,
    FailAction,
    FailoverError,
    FailoverResult,
    HopRetry,
    failover,
    failover_collect,
)

if TYPE_CHECKING:  # SDK param type — only needed to satisfy the typed `.create()` overload
    from openai.types.chat import ChatCompletionMessageParam

log = logging.getLogger("ctrlb.inference")

# llama.cpp / many local servers ignore the key but the SDK requires a non-empty string.
_PLACEHOLDER_KEY = "sk-no-key-required"

#: The llama.cpp window probe (D42). `/props` is served at the SERVER ROOT, not under the OpenAI
#: `/v1` path, so the probe strips a trailing `/v1` off the base_url before appending this.
_PROPS_PATH = "/props"
#: Probe timeout — a few seconds, independent of `request_timeout_s` (a 10-minute thinking budget must
#: not stall the lazy window probe; a failed probe just memoizes None). Named, never inline (D42).
_PROBE_TIMEOUT_S = 3.0


def _props_url(base_url: str) -> str:
    """Turn an OpenAI-style base_url (usually `…/v1`) into the llama.cpp `/props` URL at the server
    root. Strips ONE trailing `/v1` (with any trailing slashes) then appends `/props`, so
    `http://host:5001/v1` → `http://host:5001/props` and a root-style `http://host:5001` still works."""
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return f"{root}{_PROPS_PATH}"


@dataclass(frozen=True)
class _ProbedWindow:
    """One memoized `/props` probe result (D42). `n_ctx` is the effective per-slot window
    (`default_generation_settings.n_ctx`) or `None` when the probe failed / the field was absent;
    `n_ctx_train` (`meta.n_ctx_train`) is the model's training context, kept as a sanity ceiling —
    an `n_ctx` above it is still honoured (upward overrides allowed) but logged. A failed probe is
    memoized as `_ProbedWindow(None, None)` too, so a dead endpoint is asked exactly once."""

    n_ctx: int | None
    n_ctx_train: int | None


class InferenceError(RuntimeError):
    """Any backend failure (unreachable, timeout, auth, bad response, all-endpoints-failed).

    Carries the OpenAI-SDK error shape where we could capture it BEFORE the failover chain flattened
    each hop to a string (D42 reactive backstop): `status` is the HTTP status (e.g. 400) and `code` the
    machine-readable error code (e.g. `context_length_exceeded`), each `None` when unavailable — a
    non-HTTP failure, or a MULTI-HOP error whose per-endpoint structured fields were collapsed by
    `core.failover` (which keeps only strings). The message is unchanged and still carries EVERY hop's
    text, so `is_context_overflow` can substring-match the overflow even when the structured fields are
    absent. `status`/`code` reflect the LAST attempted hop (the common single-endpoint case = exact).

    `retry_after` (D43/A7) is the server-requested backoff in seconds, parsed from the RAW SDK
    exception's `Retry-After` response header BEFORE the failover chain flattened the hop (post-
    flattening the header is gone — the same pre-capture rationale as `code`/`status`). `None` when the
    backend sent no header / it was malformed; the retry curve uses it as a floor when present.

    `endpoints_tried` (D43/A4) is how many DISTINCT chain endpoints were attempted-and-failed to
    produce this terminal error — set ONLY on the all-endpoints-failed path (from
    `FailoverError.failures`), `None` for every other shape (no-endpoint-configured / a mid-stream
    drop after a successful serve). The routing machine counts a WORKER failure only for a
    single-endpoint chain failure (`endpoints_tried == 1` — the lead may live on a different
    endpoint): a multi-endpoint total outage (`> 1`) is an infra event, not worker quality, so
    escalating to an equally-dead lead is pointless (D43 review F12)."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        retry_after: float | None = None,
        endpoints_tried: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after = retry_after
        self.endpoints_tried = endpoints_tried


def _parse_retry_after(exc: BaseException) -> float | None:
    """The server-requested backoff in seconds from a RAW SDK exception's `Retry-After` header, or
    `None` (no header / malformed). Handles BOTH RFC-7231 forms: delta-seconds (`"12"`) and an
    HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"` → seconds-from-now, floored at 0). Read off
    `exc.response.headers` (the OpenAI `APIStatusError` family carries the httpx response); a non-HTTP
    error has no response ⇒ `None`. Never raises."""
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after")
    if not raw:
        return None
    raw = raw.strip()
    try:  # delta-seconds form
        secs = float(raw)
        return secs if secs >= 0 else None
    except ValueError:
        pass
    try:  # HTTP-date form (RFC 7231)
        when = parsedate_to_datetime(raw)
    except TypeError, ValueError:
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max((when - datetime.now(timezone.utc)).total_seconds(), 0.0)


def _as_inference_error(exc: BaseException) -> InferenceError | None:
    """Wrap a LIVE backend exception into a structured `InferenceError`, capturing the OpenAI-SDK
    `status_code` + `code` + `Retry-After` BEFORE `core.failover` flattens each hop to a string (D42 —
    the "pre-flattening" capture). Returns `None` for a cancellation or an already-`InferenceError`
    (nothing to convert — re-raise it raw). Only the OpenAI `APIStatusError` family exposes
    `status_code`/`code`/`response`; a non-HTTP error wraps with all `None`, its message preserved so
    failover's collected string is unchanged."""
    if isinstance(exc, (asyncio.CancelledError, InferenceError)):
        return None
    status = getattr(exc, "status_code", None)
    code = getattr(exc, "code", None)
    return InferenceError(
        str(exc),
        code=code if isinstance(code, str) else None,
        status=status if isinstance(status, int) and not isinstance(status, bool) else None,
        retry_after=_parse_retry_after(exc),
    )


#: The machine-readable OpenAI code for "prompt longer than the model's context window".
_OVERFLOW_CODE = "context_length_exceeded"
#: Conservative substring markers for the SAME failure across backends that DON'T report the code
#: (llama.cpp reports it in the 400 message text, not a code) or when the code was flattened away by
#: failover. Each phrase is specific to a context-window overflow — none appears in an unrelated 400.
#: (llama-server: "the request exceeds the available context size"; OpenAI: "maximum context length".)
_OVERFLOW_MSG_MARKERS = (
    _OVERFLOW_CODE,
    "maximum context length",
    "exceeds the available context",
    "exceed the context",
    "context window",
    "context size",
    "context shift",
    "n_ctx",
)


def _is_400(err: BaseException, text: str) -> bool:
    """ "Is this a 400?" for the message-substring classifiers — the structured `status`/`status_code`,
    else the `error code: 400` a failover-FLATTENED error still carries in its text. ONE home, shared by
    `is_context_overflow` and `is_reasoning_param_rejection` (D46 audit LOW-3: it was copy-pasted). The
    gate matters: it is what stops an unrelated 5xx/429 whose body happens to quote a marker phrase from
    being upgraded into an overflow / a param rejection. `text` is the caller's already-lowered
    `str(err)` (both callers need it anyway — no second lowering)."""
    status = getattr(err, "status", None)
    if status is None:
        status = getattr(err, "status_code", None)
    return status == 400 or "error code: 400" in text


def is_context_overflow(err: BaseException) -> bool:
    """The ONE home (D42 reactive backstop) for "is this backend failure a prompt-too-long-for-the-
    context-window error?". Matches the STRUCTURED fields first — OpenAI's HTTP 400 + code
    `context_length_exceeded` — then falls back to a conservative message-substring scan for the
    llama.cpp 400 shapes (which name the overflow in the error text, not a code) and for a
    failover-flattened `InferenceError` whose per-hop structured fields were collapsed to a string. The
    substring path is gated on the error being a 400 (its own `status`, or an "error code: 400" the
    flattened message carries) so an unrelated 400 or any 5xx/429 never matches.

    NB (recorded residual, D42): with default llama.cpp server flags the server may SILENTLY context-
    shift/truncate an over-long prompt instead of erroring — the backstop cannot fire there, since no
    error is raised. Documented for the Wave-6 deploy note; nothing to detect here."""
    status = getattr(err, "status", None)
    if status is None:
        status = getattr(err, "status_code", None)
    code = getattr(err, "code", None)
    if status == 400 and isinstance(code, str) and code == _OVERFLOW_CODE:
        return True  # OpenAI structured — the clean single-endpoint / last-hop path
    text = str(err).lower()
    return _is_400(err, text) and any(marker in text for marker in _OVERFLOW_MSG_MARKERS)


#: ── D46 reasoning-capability feedback ─────────────────────────────────────────────────────────────
#: Reasoning-control keys we can put on the wire, i.e. the ONLY keys the degradation path may strip.
#: Top-level (`reasoning_effort`) + `extra_body` sub-keys; `chat_template_kwargs.enable_thinking` is
#: handled separately (a sub-sub-key whose siblings must survive).
_REASONING_PAYLOAD_KEYS = (
    "reasoning_effort",
    "reasoning",
    "reasoning_budget_tokens",
    "thinking_budget_tokens",
)
#: The CONTROL sub-keys inside the `reasoning` vendor namespace — the ones the strip removes AND the
#: ones the absolute-`off` prune removes (F1). `enabled` IS a control: OpenRouter documents
#: `reasoning.enabled: true` as "enable reasoning at the default effort", so a provider that rejected our
#: controls will reject it again — a remembered-demotion retry that kept it would stay ineffective
#: (final foreign review, F5). The ONE key that survives a demotion is `exclude` — a response-SHAPE flag
#: (hide the reasoning from the response) an operator set deliberately, which no provider rejects for
#: capability reasons; dropping it would silently start streaming reasoning back to someone who excluded
#: it (D46 audit LOW-2, as corrected).
_REASONING_NS_CONTROL_KEYS = ("effort", "max_tokens", "enabled")
#: HTTP-400 param-rejection shapes that NAME the offending parameter RIGHT AFTER the marker, MEASURED
#: against the live OpenRouter API 2026-07-20 + OpenAI's published error strings — not a guess:
#:   - `Unrecognized request argument supplied: <name>`  the OpenAI-family unknown-key shape;
#:   - `Unsupported parameter: '<name>' is not supported with this model`  the unsupported-key shape.
#: For THESE two the gate isolates the named token and requires IT to be a reasoning key (F3) — never a
#: whole-text scan, because OpenRouter echoes the request/upstream body in `metadata.raw`, so a rejection
#: naming `tool_choice` can carry a genuine `"reasoning_effort":"high"` elsewhere in the text and would
#: otherwise false-positive into a wasted call + a permanent wrong demotion.
_PARAM_REJECT_NAMING_MARKERS = (
    "unrecognized request argument supplied",
    "unsupported parameter",
)
#: HTTP-400 param-rejection shapes that name NO key at the marker (the offending param is named ELSEWHERE
#: — before the marker, or not at all), so these keep the whole-text exact-spelling key scan (F3
#: documented residual):
#:   - `Invalid option: expected one of "max"|"xhigh"|…`  OpenRouter value-outside-enum; the key rides
#:     BEFORE it (`reasoning_effort: Invalid option: …`);
#:   - `… is not supported with this model` STANDING ALONE (no `Unsupported parameter:` prefix).
_PARAM_REJECT_VALUE_MARKERS = (
    "invalid option: expected one of",
    "not supported with this model",
)
#: The mandatory-reasoning shape — self-identifying (it IS about reasoning), so it needs no key gate.
_MANDATORY_REASONING_MARKER = "reasoning is mandatory for this endpoint"
#: The whole-text key scan for the VALUE-shape markers only (F3): a param-rejection whose key is named
#: elsewhere counts as OURS when this exact spelling appears anywhere in the flattened error.
#: **EXACT WIRE SPELLINGS ONLY — deliberately not the bare tokens `reasoning`/`thinking`** (D46 audit,
#: MED-1): the scan reads the WHOLE flattened error text, and OpenRouter echoes the upstream body (model
#: id included) in `metadata.raw`, so a bare `thinking` matched any unrelated rejection on a model slug
#: like `qwen/qwen3-30b-a3b-thinking-2507`. The quoted forms cover `Unsupported parameter: 'reasoning'`.
_REASONING_KEY_NAMES = (
    "reasoning_effort",
    "reasoning_budget_tokens",
    "thinking_budget_tokens",
    "reasoning.effort",
    "reasoning.max_tokens",
    "enable_thinking",
    "'reasoning'",
    '"reasoning"',
)
#: Reasoning parameter names for the NAMED-TOKEN gate (F3). When a naming marker isolates the offending
#: parameter, we compare the extracted token (quotes stripped) against THIS set — so the bare `reasoning`
#: form is SAFE here (it is the precise parameter name the provider objected to, never a model slug, so
#: MED-1's whole-text hazard does not apply). Dotted paths included for OpenRouter's `reasoning.effort`.
_REASONING_NAMED_PARAMS = frozenset(
    {
        "reasoning_effort",
        "reasoning",
        "reasoning_budget_tokens",
        "thinking_budget_tokens",
        "reasoning.effort",
        "reasoning.max_tokens",
        "enable_thinking",
    }
)
#: Grabs the first `param`-shaped token after a naming marker, tolerating a leading `:`/whitespace and
#: surrounding quotes: `: 'reasoning_effort' is not supported` → `reasoning_effort`; `: tool_choice …` →
#: `tool_choice`; `: reasoning.effort` → `reasoning.effort` (a `.` is part of the token).
_NAMED_PARAM_RE = re.compile(r"""['"]?([a-z0-9_.]+)['"]?""")


def _named_reject_param(text: str, marker: str) -> str | None:
    """The parameter token the provider named right after `marker` in a lowered error `text`, or None.
    `text` already contains `marker` (the caller checked). Strips the `:`/whitespace lead + one layer of
    quotes and returns the first token; None only if nothing token-shaped follows."""
    tail = text[text.find(marker) + len(marker) :].lstrip(": \t")
    m = _NAMED_PARAM_RE.match(tail)
    return m.group(1) if m else None


def is_reasoning_param_rejection(err: BaseException) -> bool:
    """ "Did the provider 400 because of the REASONING CONTROLS we sent?" — the D46 sibling of
    `is_context_overflow`, in the same one-home classifier section (and, like it, deliberately kept OUT
    of `categorize`'s `ErrorCategory`: this is handled INSIDE a hop, so it must not become a wire-visible
    retry tier or change any hop decision).

    Why a reactive predicate exists at all: reasoning limits are per-MODEL, not per-provider — OpenRouter
    publishes `reasoning.supported_efforts` per model and across 339 models the sets vary wildly (only 22
    accept `max`; many lack `none`/`minimal`). No static table in this file can be correct, so the app has
    to LEARN from the one authority that knows: the provider's own 400.

    Gated on a 400 the same way `is_context_overflow` is (own `status` or a flattened `error code: 400`).
    Then, per marker family (F3, final foreign review):
      - the self-identifying mandatory-reasoning shape → OURS, no key gate;
      - a NAMING marker (`Unsupported parameter:` / `Unrecognized request argument supplied:`) — the
        offending parameter is named right after it, so isolate THAT token and require it to be a
        reasoning key. This does NOT fall through to the whole-text scan: OpenRouter echoes the request
        body in `metadata.raw`, so a `tool_choice` rejection can quote a real `reasoning_effort` value
        elsewhere, and the whole-text scan would false-positive into a wasted call + a permanent wrong
        demotion;
      - a VALUE-shape marker (`Invalid option: expected one of` — the key rides BEFORE it — or a bare
        `not supported with this model`) names no key at the marker, so keep the whole-text exact-spelling
        key scan (the documented residual).
    A 400 about anything else (`tool_choice`, `response_format`, a bad model id) never matches."""
    text = str(err).lower()
    if not _is_400(err, text):
        return False
    if _MANDATORY_REASONING_MARKER in text:
        return True
    for marker in _PARAM_REJECT_NAMING_MARKERS:
        if marker in text:
            # The provider named the offending parameter — decide on THAT token alone (never the whole
            # text). A naming marker is authoritative: if its token isn't a reasoning key, this 400 is
            # someone else's even when the echoed body quotes a reasoning value.
            named = _named_reject_param(text, marker)
            return named in _REASONING_NAMED_PARAMS
    if any(marker in text for marker in _PARAM_REJECT_VALUE_MARKERS):
        return any(key in text for key in _REASONING_KEY_NAMES)
    return False


def _reasoning_keys_in(call_cfg: dict[str, Any]) -> list[str]:
    """The reasoning keys a built `_call_config` payload actually carries (dotted paths, for the log).
    Empty ⇒ this request had no reasoning controls, so a param-rejection cannot be ours to fix."""
    keys = [k for k in call_cfg if k in _REASONING_PAYLOAD_KEYS]
    extra = call_cfg.get("extra_body")
    if isinstance(extra, dict):
        keys += [f"extra_body.{k}" for k in extra if k in _REASONING_PAYLOAD_KEYS]
        ctk = extra.get("chat_template_kwargs")
        if isinstance(ctk, dict) and "enable_thinking" in ctk:
            keys.append("extra_body.chat_template_kwargs.enable_thinking")
    return sorted(keys)


#: The retry classifier's tiers (D43/A7). `transient` = alive-but-busy, retry the same endpoint may
#: work; `overflow` = delegates to `is_context_overflow`; `fatal_for_endpoint` = this endpoint can
#: never serve this request (auth/model/quota — a different hop has different creds, so hop, never
#: retry-same); `other` = everything else (connection/timeout/5xx — today's instant next-hop).
ErrorCategory = Literal["transient", "overflow", "fatal_for_endpoint", "other"]

#: HTTP statuses meaning "backend is alive but momentarily can't serve — a retry may work".
_TRANSIENT_STATUS = frozenset({429, 503})
#: Backend-busy message shapes for the transient class when the status was flattened away by failover
#: (or a local backend that reports it in the body). VERIFIED against ggml-org/llama.cpp `tools/server`
#: (2026-07, master): a still-loading server returns HTTP 503 `{"type":"unavailable_error","message":
#: "Loading model"}` (server-http.cpp middleware_server_state) and an exhausted slot pool returns 503
#: "no slot available" (server-context.cpp; `ERROR_TYPE_UNAVAILABLE` → 503, type "unavailable_error" in
#: server-common.cpp `format_error_response`). "rate limit"/"too many requests" cover a cloud 429 body.
_TRANSIENT_MSG_MARKERS = (
    "no slot available",
    "unavailable_error",
    "loading model",
    "rate limit",
    "too many requests",
)
#: Endpoint-fatal HTTP statuses: this endpoint's credentials/permissions can't serve — hop, never retry.
_FATAL_STATUS = frozenset({401, 403})
#: Endpoint-fatal machine codes (OpenAI-family): auth/model/quota — a different hop has its own creds.
#: Deliberately NOT the generic `invalid_request_error` type (an ordinary bad 400 is `other`, and a 400
#: overflow is already caught by the overflow-first delegation) — only codes that name a per-endpoint
#: credential/model/quota failure per D43's fatal list.
_FATAL_CODES = frozenset({"invalid_api_key", "model_not_found", "insufficient_quota"})
#: Endpoint-fatal message shapes (flattened / body-text fallback). Each is specific to a credential /
#: model-not-found / quota failure — none appears in a transient or generic error.
_FATAL_MSG_MARKERS = (
    "invalid api key",
    "incorrect api key",
    "invalid_api_key",
    "insufficient_quota",
    "insufficient quota",
    "exceeded your current quota",
    "billing",
    "model_not_found",
    "model not found",
    "does not exist",
)


def categorize(err: BaseException) -> ErrorCategory:
    """Classify a backend failure into the D43/A7 retry tiers (the ONE home, beside
    `is_context_overflow`). Structured `status`/`code` first — overflow delegates; a busy 429 or 503 ⇒
    `transient`; 401/403, 404-model-not-found, or a fatal code ⇒ `fatal_for_endpoint`; only THEN does a
    bare `Retry-After` header ⇒ `transient`. The structured status/code ranks ABOVE the Retry-After
    short-circuit in BOTH directions: a busy 429/503 stays retry-worthy even carrying a fatal code (the
    "429 wins" busy-then rule), and an auth/model/quota fatal outranks a `Retry-After` header — a fatal
    endpoint must hop to different credentials, never retry in place. Then a message-substring fallback
    for a failover-FLATTENED error whose structured fields were collapsed to a string, gated on the
    flattened `error code: N` the same way `is_context_overflow` gates on 400 (so an unrelated string
    can't upgrade a plain error; the busy/auth PHRASES are specific enough to scan ungated).
    `overflow`/`other` → straight next-hop; only `transient` is retry-worthy."""
    if is_context_overflow(err):
        return "overflow"
    status = getattr(err, "status", None)
    if status is None:
        status = getattr(err, "status_code", None)
    status = status if isinstance(status, int) and not isinstance(status, bool) else None
    code = getattr(err, "code", None)
    code_l = code.lower() if isinstance(code, str) else ""
    text = str(err).lower()
    # ── structured status/code first — a decisive status/code ranks above the Retry-After header ──
    if status in _TRANSIENT_STATUS:  # busy 429/503 wins even alongside a fatal code (busy-then)
        return "transient"
    if status in _FATAL_STATUS or code_l in _FATAL_CODES:  # auth/quota fatal outranks any Retry-After
        return "fatal_for_endpoint"
    if status == 404 and ("model" in text or code_l == "model_not_found"):
        return "fatal_for_endpoint"
    # ── a bare Retry-After header (no decisive status/code above): the server asked us to wait ──
    if getattr(err, "retry_after", None) is not None:
        return "transient"
    # ── message fallback: only when the structured fields didn't decide (flattened / body text) ──
    if (
        any(m in text for m in _TRANSIENT_MSG_MARKERS)
        or "error code: 429" in text
        or "error code: 503" in text
    ):
        return "transient"
    if any(m in text for m in _FATAL_MSG_MARKERS) or "error code: 401" in text or "error code: 403" in text:
        return "fatal_for_endpoint"
    return "other"


#: The transient-retry backoff curve (D43/A7 — fixed module constants, NOT configurable: the one-knob-
#: one-unit bar. The knob is the ATTEMPT COUNT; the curve is policy). Base delay, doubled per attempt.
_RETRY_BASE_DELAY_S = 2.0
#: The backoff cap: a server-provided `Retry-After` larger than the curve wins, but nothing waits past
#: this (a 10-minute `Retry-After` must not wedge a turn). Named, never inline (D42 bar).
_RETRY_DELAY_CAP_S = 30.0


def _retry_delay(attempt: int, retry_after: float | None) -> float:
    """The backoff before retry `attempt` (0-based): `base × 2^attempt`, but a larger server-provided
    `Retry-After` wins, all capped at `_RETRY_DELAY_CAP_S` (D43/A7)."""
    curve = _RETRY_BASE_DELAY_S * (2**attempt)
    return min(max(curve, retry_after or 0.0), _RETRY_DELAY_CAP_S)


def _resolve_retry_attempts(cfg: InferenceCfg, ep: InferenceEndpointCfg) -> int:
    """The per-hop chat-stream retry budget (D43/A7): the endpoint override when set, else the global
    (`None` inherits, `0` disables) — the compaction global+override resolve pattern, one home."""
    return ep.retry_attempts if ep.retry_attempts is not None else cfg.retry_attempts


#: The reasoning-effort LADDER → per-request token budget, for the dialects that accept a budget (D45).
#: FIXED module constants, not config — the D43 precedent: a policy curve (like the retry backoff) is
#: constants, and the per-agent `ModelRef.reasoning_tokens` override IS the configurability escape hatch.
#: The two ends are NOT invented mappings — they are llama.cpp's OWN documented sentinels: `0` = end
#: thinking immediately, `-1` = unrestricted. The middle is the ladder spread across a typical thinking
#: window. A per-request value overrides the server's `--reasoning-budget` launch flag (PR #23116).
_REASONING_BUDGETS: dict[str, int] = {
    "off": 0,
    "minimal": 256,
    "low": 512,
    "medium": 2048,
    "high": 8192,
    "xhigh": 16384,
    "max": -1,
}


def _resolve_reasoning_budget(effort: str | None, tokens: int | None) -> int | None:
    """The per-request reasoning budget for a budget-speaking dialect (D45): `"off"` is ABSOLUTE, then
    an EXPLICIT `ModelRef.reasoning_tokens` wins, else the `reasoning_effort` ladder, else `None` (send
    nothing — the server keeps its own default). One home for the precedence, shared by every dialect
    branch.

    `"off"` OUTRANKS the explicit override (D45 adversarial audit, FIX 3): the pair `off` + a budget is
    self-contradictory, and honouring the budget produced a payload that told the sampler "think up to N"
    while the template lever told the model "emit no thinking block". "The user asked for no reasoning"
    is the unambiguous reading, so `off` collapses to the `0` sentinel and the override is ignored."""
    if effort == "off":
        return _REASONING_BUDGETS["off"]
    if tokens is not None:
        return tokens
    if effort is not None:
        return _REASONING_BUDGETS.get(effort)
    return None


#: Our ladder → OpenRouter's `reasoning_effort` enum, which is
#: `max | xhigh | high | medium | low | minimal | none` — MEASURED against the live API 2026-07-20, not
#: read off a docs page (D45 AMENDED-3 / D46). Only ONE end needs translating: our `"off"` is their
#: `"none"`. `"max"` rides VERBATIM — the earlier `max → xhigh` clamp fixed a non-bug from a stale docs
#: page and silently downgraded effort on the 22 models that do accept `max`; the provider's own reject
#: text for a genuinely invalid value reads `Invalid option: expected one of "max"|"xhigh"|"high"…`,
#: i.e. `max` is in the enum. **Per-MODEL caveat:** `GET /api/v1/models` publishes
#: `reasoning.supported_efforts` PER MODEL and the sets vary wildly (across 339 models only 22 accept
#: `max`; many lack `none`/`minimal`), so ANY value here can still be rejected by a particular model.
#: No static table can be correct — that residual is handled REACTIVELY by the D46 capability feedback
#: (`is_reasoning_param_rejection` → strip + retry once + remember), never by more clamping here.
_OPENROUTER_EFFORT: dict[str, str] = {"off": "none"}

#: `extra_body` sub-objects that are DEEP-merged (per-call sub-keys win, the endpoint's others survive)
#: rather than replaced wholesale. Both are dict-valued vendor namespaces where an endpoint legitimately
#: hand-sets sibling keys we never touch (`chat_template_kwargs: {…}`, OpenRouter `reasoning: {exclude}`),
#: so a flat `update()` would silently drop the operator's configuration (D45 adversarial audit, FIX 2).
_EXTRA_BODY_DEEP_MERGE_KEYS = ("chat_template_kwargs", "reasoning")


def _looks_self_hosted(base_url: str) -> bool:
    """Cheap, PURELY LEXICAL "does this base_url point at a server on my own machine/LAN?" — no DNS, no
    network probe (D45 audit FIX 5: a startup check must never touch the network). Loopback / private
    range / `.local` / a bare dotless hostname (`emma:8080`) / any non-web port all say self-hosted;
    `https://api.openai.com/v1` says cloud. Deliberately advisory-only: its single caller emits a
    WARNING, so a false positive costs one log line and a false negative costs nothing new."""
    try:
        parts = urlsplit(base_url if "://" in base_url else f"http://{base_url}")
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        return False
    if not host:
        return False
    if host == "localhost" or host.endswith(".local") or "." not in host.strip("[]"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if ip.is_loopback or ip.is_private:
            return True
    return port is not None and port not in (80, 443)


def warn_suspect_api_modes(cfg: InferenceCfg) -> None:
    """Log a WARNING for every configured endpoint that keeps the DEFAULT `api_mode: openai`
    while its `base_url` looks self-hosted (D45 audit FIX 5).

    Why this exists: D45's default is `openai` for byte-for-byte back-compat, but its whole premise is
    that llama-server DISCARDS `reasoning_effort`. Every already-deployed `config.yaml` is gitignored
    and untouched by the release, so the feature lands INERT — and silently — on exactly the install it
    was built for. This is the feedback. Called from `runtime.set_inference`, i.e. once per config load
    and once per settings PUT that rebuilds the client, which is the natural "the config just changed"
    boundary. It is advisory: nothing branches on it, and a cloud endpoint on a custom port simply gets
    one line telling it no action is needed — and NOTHING ever branches on it (D46: no wire shape is
    ever inferred from a `base_url`; this heuristic exists only to tell a HUMAN to set the field)."""
    named: list[tuple[str, InferenceEndpointCfg]] = [
        ("inference.local", cfg.local),
        ("inference.cloud", cfg.cloud),
        *((f"inference.fallbacks[{i}]", ep) for i, ep in enumerate(cfg.fallbacks)),
    ]
    for path, ep in named:
        if not ep.base_url or ep.api_mode != "openai" or not _looks_self_hosted(ep.base_url):
            continue
        log.warning(
            "%s (base_url=%s) uses the default api_mode 'openai', but that base_url looks "
            "self-hosted. llama-server IGNORES `reasoning_effort`, so every agent's reasoning_effort / "
            "reasoning_tokens setting is a NO-OP on this endpoint. If it is llama.cpp, set "
            "`%s.api_mode: llamacpp` in your config.yaml (D45/D46); vLLM/other → 'none' until a "
            "mode exists; a real OpenAI-compatible cloud API on a custom port → no action needed.",
            path,
            ep.base_url,
            path,
        )


@dataclass(frozen=True)
class RetryNotice:
    """A wire item `stream_chat` interleaves BEFORE the first `ChatDelta` (D43/A6): the served endpoint
    hit a retry-worthy error and is about to sleep `delay_s` then re-attempt (`attempt` of
    `max_attempts`). `endpoint` is the chain entry's name; `category` is the classifier tier. Wave 2
    re-emits it as an `inference.retry` AgentEvent; Wave-1 session consumers skip it."""

    endpoint: str
    attempt: int
    max_attempts: int
    delay_s: float
    category: str


@dataclass(frozen=True)
class FailoverNotice:
    """A wire item `stream_chat` interleaves BEFORE the first `ChatDelta` (D43/A6): the chain dropped
    from `from_endpoint` to `to_endpoint`. `category` is the triggering error's classifier tier. Wave 2
    re-emits it as an `inference.failover` AgentEvent; Wave-1 session consumers skip it."""

    from_endpoint: str
    to_endpoint: str
    category: str


@dataclass
class StreamReport:
    """Optional out-param for `stream_chat`/`complete` so the session can surface failover degradation
    (D18): `served` is the endpoint name that answered (e.g. "cloud"); `degraded` is True when a
    fallback had to save us; `failures` carries each failed hop's error. Pass one to learn whether the
    request fell over — the failover primitive also logs it server-side regardless.

    Also the channel for prompt-cache telemetry (ACA-18): `prompt_tokens` is how many tokens the server
    prefilled this call and `cached_tokens` how many it reused from the prompt-prefix cache — read off
    the response wherever the endpoint reports it (llama.cpp `timings.prompt_n`/`cache_n`, streaming
    `prompt_progress`; OpenAI `usage.prompt_tokens`/`usage.prompt_tokens_details.cached_tokens`). `None`
    means the endpoint didn't report that number (e.g. a local server without `return_progress`, or a
    cloud one without `stream_options: {include_usage: true}`) — NOT a cache miss. The session logs it
    next to its A8 estimate so prefix cost + hit rate read together.

    `served_endpoint` (D42) is the endpoint OBJECT that actually answered (`chain[served_index][1]`) —
    distinct from `served` (its name): the session prices iteration 2+'s window-aware compaction
    trigger against the endpoint that served (its `context_window`/probe + the `prompt_tokens` anchor
    come from the same serve). `None` until a call completes."""

    served: str = ""
    degraded: bool = False
    failures: list[str] = field(default_factory=list)
    prompt_tokens: int | None = None
    cached_tokens: int | None = None
    served_endpoint: InferenceEndpointCfg | None = None


@dataclass
class ToolCallRequest:
    """One completed tool call the model asked for. `arguments` is the raw JSON string the model
    emitted — parsed + validated against the tool's `input_model` by the session (a malformed
    blob becomes an error result fed back, never a crash)."""

    id: str
    name: str
    arguments: str = ""


@dataclass
class ChatDelta:
    """One streamed increment. `text`/`reasoning` are per-token; `tool_calls` is the terminal
    delta carrying the fully-accumulated calls once the stream finishes (OpenAI streams them as
    index-keyed fragments, reassembled here)."""

    text: str = ""
    reasoning: str = ""
    tool_calls: list[ToolCallRequest] = field(default_factory=list)


#: A resolved chain entry: (name, endpoint, model-to-use). The model is the override for the selected
#: endpoint, else the endpoint's own — precomputed so failover attempts don't re-derive it.
_ChainEntry = tuple[str, InferenceEndpointCfg, str]


class EndpointGates:
    """The app-owned registry of per-endpoint request-gate semaphores (D40 rider; D42 Codex FIX 1).

    Keyed by `(base_url, limit)`. Owned once on `app.state.endpoint_gates` and passed into EVERY
    `InferenceClient` generation by `runtime.set_inference`, so a settings PUT that rebuilds the client
    does NOT mint a second semaphore for the same endpoint: old-generation permit holders and
    new-generation acquirers contend on the ONE object, and `max_concurrent_requests` is never split
    across generations (the cap-doubling defect — limit 1 becoming 2 across a mid-turn reconfigure).
    A CHANGED `limit` mints a fresh gate under the new key — the old key's semaphore keeps draining its
    in-flight holders on the OLD cap (accepted drain semantics: a limit change is rare, and the requests
    already in flight finish under the cap they started on). An `InferenceClient` built WITHOUT a
    registry (tests / standalone construction) gets a private instance — behaviourally identical to the
    old per-client dict."""

    def __init__(self) -> None:
        self._sems: dict[tuple[str, int], asyncio.Semaphore] = {}

    def sem_for(self, base_url: str, limit: int) -> asyncio.Semaphore:
        """The semaphore for `(base_url, limit)`, built lazily on first use INSIDE the running loop (so
        the 3.14 `asyncio.Semaphore` binds to the right loop). Same key ⇒ the SAME object across every
        client generation (the cap is shared); a new limit ⇒ a fresh object."""
        key = (base_url, limit)
        sem = self._sems.get(key)
        if sem is None:
            sem = asyncio.Semaphore(limit)
            self._sems[key] = sem
        return sem


class InferenceClient:
    """Builds + caches one OpenAI client per base_url; streams chat completions as `ChatDelta`s, with
    a primary→fallback chain (D18) applied at stream initiation."""

    def __init__(self, cfg: InferenceCfg, gates: EndpointGates | None = None) -> None:
        self._cfg = cfg
        self._clients: dict[str, AsyncOpenAI] = {}
        #: The per-endpoint request-gate registry (D40 rider; D42 Codex FIX 1). The semaphores that cap
        #: `max_concurrent_requests` live in this registry, NOT on the client — so a settings PUT that
        #: rebuilds the client (`runtime.set_inference`) passes the SAME registry in and old-generation
        #: permit holders + new-generation acquirers contend on ONE semaphore per `(base_url, limit)`
        #: (the cap can't be split across client generations). `None` (tests / standalone construction)
        #: → a private per-client registry, behaviourally identical to the old per-client dict.
        self._gates = gates if gates is not None else EndpointGates()
        #: Memoized `/props` window probes, keyed by base_url (D42). Populated on first `probed_context_window`
        #: per URL — including FAILED probes (memoized as `_ProbedWindow(None, None)`), so a dead/cloud
        #: endpoint is hit at most once. No invalidation bookkeeping: `runtime.set_inference` rebuilds the
        #: whole `InferenceClient` on ANY inference-settings change, so a config edit re-probes for free.
        self._window_memo: dict[str, _ProbedWindow] = {}
        #: Single-flight lock around the `/props` probe (D42 Codex FIX 6): concurrent first-use callers
        #: would otherwise each issue a GET before the memo is written, so probe+memoize runs under this
        #: lock with a double-check of the memo inside it. ONE lock per client (a single local endpoint is
        #: probed — per-URL task-futures are overkill). Built lazily inside the loop (like the gates).
        self._probe_lock: asyncio.Lock | None = None
        #: Lazily-built httpx client for the raw `/props` GET (the SDK is chat-only). Built on first probe,
        #: reused per-process like the SDK clients; not aclosed on rebuild (same as the SDK clients here).
        self._probe_http: httpx.AsyncClient | None = None
        #: R4 one-time guard: a completed stream that reported NO prompt-token total means the anchored
        #: context estimator can't anchor on this endpoint (compaction runs on the chars/4 heuristic). We
        #: log that ONCE per client instance. `set_inference` rebuilds the whole client on any inference
        #: change, so a fresh instance re-evaluates after a config edit (return_progress/include_usage).
        self._anchoring_notice_emitted = False
        #: D46 capability feedback: `(base_url, model)` pairs whose provider 400'd on our reasoning
        #: controls. Once recorded, every later request to that pair is built WITHOUT them — so the
        #: doomed attempt is paid exactly once, not once per turn. Client-instance state on purpose, with
        #: TWO invalidation paths (final foreign review, F6 — the old comment's "for free on any agent
        #: edit" was FALSE): an INFERENCE-section edit rebuilds the whole `InferenceClient` via
        #: `runtime.set_inference`, minting a fresh empty set (the `_window_memo` precedent); an AGENT-FILE
        #: edit (the folder-per-agent API) never rebuilds the client, so it clears explicitly through
        #: `clear_reasoning_demotions()` below, driven by the `runtime.clear_reasoning_demotions` hook.
        self._reasoning_demoted: set[tuple[str, str]] = set()

    def _reasoning_is_demoted(self, ep: InferenceEndpointCfg, model: str) -> bool:
        """Has `(endpoint, model)` already been demoted (D46)? ⇒ build the payload stripped from the
        start; the provider already told us these controls are unusable there."""
        return (ep.base_url, model) in self._reasoning_demoted

    def clear_reasoning_demotions(self) -> None:
        """Forget every learned reasoning demotion (D46/F6). The explicit invalidation hook for the
        file-per-agent API, which mutates an agent's `reasoning_effort`/`reasoning_tokens` WITHOUT
        rebuilding the client (only an inference-section edit does that), so a corrected setting would
        otherwise keep being stripped until an unrelated inference edit or a restart. Called through the
        `runtime.clear_reasoning_demotions` chokepoint so the API layer never imports the client."""
        if self._reasoning_demoted:
            log.debug("clearing %d reasoning demotion(s) after a config edit", len(self._reasoning_demoted))
        self._reasoning_demoted.clear()

    def _note_reasoning_demotion(
        self,
        exc: BaseException,
        *,
        name: str,
        ep: InferenceEndpointCfg,
        model: str,
        reasoning_effort: str | None,
        reasoning_tokens: int | None,
    ) -> bool:
        """ "Was this failure the provider rejecting our reasoning controls, and is there something to
        strip?" — if so, record the demotion for `(endpoint, model)`, log it LOUDLY **once**, and return
        True so the caller re-attempts the SAME endpoint ONCE with a stripped payload (D46).

        The WARNING is not decoration: RFC 9413 §5.1 — a fault must receive attention. Silently dropping
        unsupported params (LiteLLM's `drop_params`) is the documented anti-pattern; aider's
        `Warning: <model> does not support '<param>', ignoring.` is the model followed here, extended with
        the provider's own message so the operator can act. Fires once per `(endpoint, model)` per client
        generation, NOT once per turn — the demotion set is both the memory and the log guard.

        Order matters under CONCURRENCY (final foreign review, F4): compute `dropped` FIRST (the genuine
        "is there anything to strip?" gate), then handle an already-present key. Two unstripped requests
        can 400 on the same pair before either records the demotion (no semaphore, or
        `max_concurrent_requests > 1`); the LATE one finds the key already recorded, but it is STILL a
        genuine reasoning-400, so it must be told to retry stripped — the old "return False, this 400 is
        about something else" wrongly failed the hop for nothing. It just skips the second WARNING (a
        debug line marks the race). Loop-safety is untouched: a request BUILT stripped never reaches here
        at all (its caller short-circuits `_note` on `stripped`), so this can never cause a strip loop."""
        if not is_reasoning_param_rejection(exc):
            return False
        dropped = _reasoning_keys_in(
            self._call_config(
                ep, max_tokens=None, reasoning_effort=reasoning_effort, reasoning_tokens=reasoning_tokens
            )
        )
        if not dropped:
            return False  # nothing to strip ⇒ not our 400 to fix
        key = (ep.base_url, model)
        if key in self._reasoning_demoted:
            # A concurrent request already recorded this exact demotion — retry stripped, but don't
            # re-warn (already emitted once, and the demotion set is the log guard).
            log.debug("reasoning demotion for %s already recorded by a concurrent request", key)
            return True
        self._reasoning_demoted.add(key)
        log.warning(
            "inference endpoint '%s' (%s, model=%s) REJECTED the reasoning controls %s with HTTP 400 — "
            "retrying this request once without them, and dropping them for this endpoint+model until a "
            "config edit clears it (an inference-section edit rebuilds the client; an agent's reasoning "
            "edit clears via the runtime hook — D46/F6). Reasoning support is per-MODEL (OpenRouter "
            "publishes reasoning.supported_efforts per model), so this is capability feedback, not "
            "necessarily a config error: to stop it, change the agent's reasoning_effort/reasoning_tokens "
            "or this endpoint's api_mode. The provider said: %s",
            name,
            ep.base_url,
            model,
            ", ".join(dropped),
            exc,
        )
        return True

    def _probe_client(self) -> httpx.AsyncClient:
        if self._probe_http is None:
            self._probe_http = httpx.AsyncClient(timeout=_PROBE_TIMEOUT_S)
        return self._probe_http

    async def probed_context_window(self, ep: InferenceEndpointCfg) -> int | None:
        """The effective context window for `ep` as reported by the llama.cpp `/props` probe, or `None`
        when unavailable (probe failed, non-200, malformed body, no `n_ctx`, or a blank base_url). Lazy +
        memoized per base_url for the client's lifetime; NEVER raises (the `_capture_cache_telemetry`
        posture — a probe must not block or fail a turn). Endpoint-agnostic: it probes whatever base_url
        it is given (only meaningful for a local llama.cpp — cloud has no `/props` — but callers decide
        who to probe; the config>probe>fallback resolution policy lands in Wave 2)."""
        base_url = ep.base_url
        if not base_url:
            return None
        cached = self._window_memo.get(base_url)
        if cached is not None:
            return cached.n_ctx
        # Single-flight (D42 Codex FIX 6): serialize concurrent first-use probes so exactly ONE GET is
        # issued, double-checking the memo inside the lock (a racer that probed while we waited wins).
        # The check-then-set of the lazy lock has no await between, so it's atomic in asyncio.
        if self._probe_lock is None:
            self._probe_lock = asyncio.Lock()
        async with self._probe_lock:
            cached = self._window_memo.get(base_url)
            if cached is None:
                cached = await self._probe_props(base_url)
                self._window_memo[base_url] = cached
        return cached.n_ctx

    def _is_probe_eligible(self, ep: InferenceEndpointCfg) -> bool:
        """The ONE home for the D42 probe-eligibility rule: only the configured LOCAL llama.cpp
        endpoint is probed — cloud/OpenAI has no `/props` (verified), and `fallbacks` rely on their
        manual `context_window`. Matched by `base_url` against the live local endpoint, so it holds for
        BOTH the selected-endpoint object (iteration 1) and the served-endpoint object off the failover
        chain (iteration 2+) — they are the same configured endpoints. A blank local base_url makes
        nothing eligible."""
        local = self._cfg.local
        return bool(ep.base_url) and ep.base_url == local.base_url

    async def effective_window(self, ep: InferenceEndpointCfg) -> int | None:
        """Resolve `ep`'s effective context window per the D42 ladder — **config > probe > None**:
        the explicit `ep.context_window` wins (the owner runs the server and may set a value that
        exceeds the probe — the silent down-clamp is the recorded anti-pattern); else the probed
        `/props` `n_ctx` **only for the probe-eligible local llama.cpp** (`_is_probe_eligible` — one
        rule, one place); else `None` ⇒ the caller's `threshold_tokens` absolute-fallback trigger.
        Never raises (the probe swallows all failures to `None`)."""
        if ep.context_window is not None:
            return ep.context_window
        if self._is_probe_eligible(ep):
            return await self.probed_context_window(ep)
        return None

    async def effective_window_for(self, mode: str | None = None) -> int | None:
        """The effective context window for the endpoint SELECTED by `mode` (the D42 ladder via
        `effective_window`) — the mode-shaped convenience mirroring `model_for(mode)`. Used by the
        compaction summarizer's overflow guard (Wave 3) to read its OWN `ModelRef.mode` endpoint's
        window without reaching into `_cfg`. `None` ⇒ no window resolvable (the caller decides)."""
        return await self.effective_window(self._cfg.endpoint(mode))

    async def _probe_props(self, base_url: str) -> _ProbedWindow:
        """GET `{root}/props` once and extract the window. NEVER raises — any exception / non-200 /
        malformed body ⇒ `_ProbedWindow(None, None)` (memoized by the caller, so no retry storm)."""
        url = _props_url(base_url)
        try:
            resp = await self._probe_client().get(url)
            if resp.status_code != 200:
                return _ProbedWindow(None, None)
            body = resp.json()
            gen = body.get("default_generation_settings") if isinstance(body, dict) else None
            meta = body.get("meta") if isinstance(body, dict) else None
            n_ctx = gen.get("n_ctx") if isinstance(gen, dict) else None
            n_ctx_train = meta.get("n_ctx_train") if isinstance(meta, dict) else None
            n_ctx = n_ctx if isinstance(n_ctx, int) and not isinstance(n_ctx, bool) else None
            n_ctx_train = (
                n_ctx_train if isinstance(n_ctx_train, int) and not isinstance(n_ctx_train, bool) else None
            )
            if n_ctx is not None and n_ctx_train is not None and n_ctx > n_ctx_train:
                # Upward overrides are allowed (the owner may raise the served window past the model's
                # training context), but it's worth a breadcrumb — an unexpectedly huge n_ctx is a smell.
                log.info("probe %s: n_ctx=%d exceeds n_ctx_train=%d (honoured)", url, n_ctx, n_ctx_train)
            return _ProbedWindow(n_ctx, n_ctx_train)
        except Exception:  # noqa: BLE001 — a window probe must NEVER fail or block a turn (D42)
            return _ProbedWindow(None, None)

    def _sem_for(self, ep: InferenceEndpointCfg) -> asyncio.Semaphore | None:
        """The request-gate semaphore for this endpoint, or `None` when unlimited. Delegates to the
        shared `EndpointGates` registry (D42 Codex FIX 1), keyed by `(base_url, limit)` so the SAME
        endpoint shares ONE semaphore across every client generation — a hot-reload that rebuilds the
        client reuses the same gate (limit unchanged) instead of splitting the cap across generations.

        LOW-1 caveat: the key is `(base_url, limit)`, so two DISTINCT endpoint entries that share a
        base_url but declare DIFFERENT `max_concurrent_requests` mint independent semaphores — their
        limits add, over-subscribing that backend. Unreachable in the shipped config (the chain is
        local + `cloud=None`, one entry per base_url) and keyed this way deliberately: a hot-reload
        that changes an endpoint's limit must NOT reuse the old-limit semaphore, so `limit` is part of
        the key on purpose. Coalesce on `base_url` alone only if a future config lets two live entries
        share one URL with different caps."""
        limit = ep.max_concurrent_requests
        if limit is None:
            return None
        return self._gates.sem_for(ep.base_url, limit)

    def _client(self, ep: InferenceEndpointCfg) -> AsyncOpenAI:
        if not ep.base_url:
            raise InferenceError("no inference base_url configured")
        if ep.base_url not in self._clients:
            self._clients[ep.base_url] = AsyncOpenAI(
                base_url=ep.base_url,
                api_key=ep.api_key or _PLACEHOLDER_KEY,
                timeout=self._cfg.request_timeout_s,
                max_retries=0,  # a 10-minute thinking call must not be silently retried
            )
        return self._clients[ep.base_url]

    def model_for(self, mode: str | None = None) -> str:
        return self._cfg.endpoint(mode).model

    def endpoint(self, mode: str | None = None) -> InferenceEndpointCfg:
        """The endpoint SELECTED by `mode` off THIS client's CAPTURED config generation (D42 Codex FIX
        3) — the mode-shaped accessor mirroring `model_for`/`effective_window_for`. The session prices
        the compaction trigger through this, so a settings PUT that mutates the shared `Settings` in
        place mid-turn cannot swing the pricing to a different endpoint than the CAPTURED client is
        streaming through (the D42 hot-at-NEXT-turn pin — the client is rebuilt only between turns)."""
        return self._cfg.endpoint(mode)

    @staticmethod
    def _call_config(
        ep: InferenceEndpointCfg,
        *,
        max_tokens: int | None,
        reasoning_effort: str | None,
        reasoning_tokens: int | None = None,
        strip_reasoning: bool = False,
    ) -> dict[str, Any]:
        """The per-ENDPOINT modeled call params + the per-call `extra_body` merge (D42/A10; per-mode
        reasoning D45/D46).
          - `max_tokens` → keyed by THIS endpoint's `resolved_max_tokens_field` ("max_tokens" |
            "max_completion_tokens" — explicit override, else derived from `api_mode`, D46), resolved per
            serving endpoint so a failover serve uses its own field name;
          - reasoning → translated ONCE through this endpoint's `api_mode` (D45). The single
            primary knob is the `reasoning_effort` LADDER; `reasoning_tokens` is an explicit OVERRIDE
            that wins WHERE THE DIALECT HAS A BUDGET and is dropped where it has none (correct, not a
            gap). **`"off"` is ABSOLUTE and outranks the override** (audit FIX 3) — it means "no
            reasoning", so the budget collapses to `0` and `reasoning_tokens` is ignored. On the
            `llamacpp` dialect ONLY, `"off"` ADDITIONALLY merges `chat_template_kwargs:
            {enable_thinking:false}` (the template-level lever, complementing the sampler-level budget
            0). That lever is a llama.cpp/vLLM concept: leaking it onto a cloud dialect is the same
            unknown-body-key 400 that ACA-18 fixed for `cache_prompt`/`return_progress` (audit FIX 4).

        PRECEDENCE, one sentence: `off` beats `reasoning_tokens` beats the `reasoning_effort` ladder;
        and within `extra_body["reasoning"]`, a per-call `max_tokens` beats any `effort` the endpoint
        hand-set (they are mutually exclusive on OpenRouter — a hard 400 — so exactly one survives).

        TRANSPORT (D45 build audit, HIGH): "modeled params ride as first-class kwargs, never smuggled
        through extra_body" holds for params the SDK actually MODELS. `AsyncCompletions.create` has a
        CLOSED signature (no `**kwargs`) and models `reasoning_effort` but NOT `reasoning_budget_tokens`
        / `thinking_budget_tokens` / `reasoning` — passing those as kwargs raises `TypeError` before a
        byte reaches the wire (and, wrapped by the failover chain, would burn every endpoint first). So
        the vendor-specific reasoning keys ride in `extra_body`, which is precisely the SDK's designated
        passthrough for un-modeled body keys (the `cache_prompt`/`return_progress` precedent). Pinned by
        a signature test — if the SDK ever models them, that test fails and the branch can move up.

        Per-call keys WIN over the endpoint's own `extra_body` while its other keys (and other
        `chat_template_kwargs` sub-keys) survive; the config object is NEVER mutated (fresh dicts).
        Unset fields contribute NOTHING (no `None`-valued keys reach the wire).

        `strip_reasoning=True` (D46) builds the SAME payload with every reasoning control removed — ours
        AND any the endpoint hand-set in `extra_body` — and nothing else touched. It is the degraded
        re-attempt after a provider 400s on the reasoning controls (`is_reasoning_param_rejection`),
        because those limits are per-MODEL and no static table here can predict them."""
        out: dict[str, Any] = {}
        if max_tokens is not None:
            out[ep.resolved_max_tokens_field] = max_tokens
        #: Un-modeled, vendor-specific body keys for THIS call — merged into `extra_body` below (see
        #: TRANSPORT above). `reasoning_effort` is NOT here: the SDK models it, so it stays a kwarg.
        body: dict[str, Any] = {}
        dialect = "none" if strip_reasoning else ep.api_mode
        if dialect == "openai":
            # Effort-only API. `reasoning_tokens` is DROPPED: OpenAI exposes no reasoning-token budget
            # (`max_completion_tokens` is a COMBINED reasoning+output cap, not a reasoning budget).
            # Our `"off"` is spelled `"none"` in OpenAI's `none|minimal|low|medium|high` enum — mapping
            # it (audit FIX 4 / LOW-6) turns what was a DOUBLE 400 (bad enum value AND an unknown
            # `chat_template_kwargs` body key) into a valid request. `xhigh`/`max` still pass verbatim:
            # they have no OpenAI spelling at all, and silently clamping would LIE about what was asked.
            # A strict endpoint that rejects them now feeds back (D46: warn + one stripped retry +
            # remember) instead of burning the chain — see D45 residual ⓒ.
            if reasoning_effort is not None:
                out["reasoning_effort"] = "none" if reasoning_effort == "off" else reasoning_effort
        elif dialect == "llamacpp":
            # llama-server never reads `reasoning_effort` (zero occurrences in the server source —
            # maintainer-confirmed), so we deliberately do NOT send it: the honest translation is the
            # per-request integer budget it DOES parse. `reasoning_budget_tokens` is the current name,
            # `thinking_budget_tokens` the older alias — send BOTH (older builds know only the alias,
            # and unknown keys are ignored, so the pair is free back-compat).
            budget = _resolve_reasoning_budget(reasoning_effort, reasoning_tokens)
            if budget is not None:
                body["reasoning_budget_tokens"] = budget
                body["thinking_budget_tokens"] = budget
            if reasoning_effort == "off":
                # The TEMPLATE-level lever, complementing the sampler-level budget 0 — two layers, not a
                # duplicate. Scoped to this branch: `chat_template_kwargs` is a llama.cpp/vLLM key and an
                # OpenAI-shaped backend 400s on unknown body args (the ACA-18 rule, 15 lines below).
                body["chat_template_kwargs"] = {"enable_thinking": False}
        elif dialect == "openrouter":
            # `reasoning.effort` and `reasoning.max_tokens` are MUTUALLY EXCLUSIVE — sending both is a
            # hard 400. `off` is absolute (→ its `"none"` enum, budget ignored); else an explicit budget
            # wins; else the ladder through `_OPENROUTER_EFFORT` (OpenRouter publishes its own effort→%
            # mapping, so effort is the better signal when no budget was set). Only `off` is translated
            # — `max`/`xhigh` are real enum members and ride verbatim (the D45 AMENDED-2 ⓐ clamp was a
            # stale-docs non-bug); per-MODEL rejection is D46's job, not another clamp here.
            if reasoning_effort == "off":
                out["reasoning_effort"] = _OPENROUTER_EFFORT["off"]
            elif reasoning_tokens is not None:
                body["reasoning"] = {"max_tokens": reasoning_tokens}
            elif reasoning_effort is not None:
                out["reasoning_effort"] = _OPENROUTER_EFFORT.get(reasoning_effort, reasoning_effort)
        # dialect == "none": the server understands no reasoning control — drop both.
        extra = dict(ep.extra_body) if ep.extra_body else {}
        if strip_reasoning:
            # D46: the endpoint's OWN reasoning config goes too — it is part of "the reasoning controls
            # in this payload", and a provider that just rejected them will reject them again. Scoped
            # EXACTLY to the reasoning CONTROLS; every other operator key (`cache_prompt`,
            # `stream_options`, other `chat_template_kwargs` siblings) survives.
            for key in _REASONING_PAYLOAD_KEYS:
                if key != "reasoning":  # the vendor namespace is pruned per-sub-key just below
                    extra.pop(key, None)
            # `reasoning` is a NAMESPACE, not a control: `exclude` is a response-SHAPE flag (hide the
            # reasoning from the response), so dropping the object wholesale would silently start
            # streaming reasoning back to an operator who explicitly asked to exclude it (audit LOW-2).
            # Same copy-and-replace prune `chat_template_kwargs` gets — controls out, siblings survive.
            reasoning_ns = extra.get("reasoning")
            if isinstance(reasoning_ns, dict):
                kept = {k: v for k, v in reasoning_ns.items() if k not in _REASONING_NS_CONTROL_KEYS}
                if kept:
                    extra["reasoning"] = kept
                else:
                    extra.pop("reasoning")
            ctk = extra.get("chat_template_kwargs")
            if isinstance(ctk, dict) and "enable_thinking" in ctk:
                pruned = {k: v for k, v in ctk.items() if k != "enable_thinking"}
                if pruned:  # copy-and-replace: never mutate the endpoint's nested dict
                    extra["chat_template_kwargs"] = pruned
                else:
                    extra.pop("chat_template_kwargs")
        for key, val in body.items():
            # Per-call keys win over an endpoint that hand-set the same key; the dict-valued vendor
            # namespaces DEEP-merge so the endpoint's sibling sub-keys (`chat_template_kwargs` extras,
            # OpenRouter's `reasoning:{exclude}`) survive instead of being replaced wholesale.
            prior = extra.get(key)
            if key in _EXTRA_BODY_DEEP_MERGE_KEYS and isinstance(prior, dict) and isinstance(val, dict):
                extra[key] = {**prior, **val}
            else:
                extra[key] = val
        # The mutual-exclusion / off-absolute reconciliation is for the LIVE payload only. When
        # `strip_reasoning`, the block above already removed every reasoning control (ours AND the
        # endpoint's), so there is nothing to reconcile and — crucially — nothing to RE-INTRODUCE (an
        # `off` request must not add `effort: "none"` back onto a payload we are stripping).
        merged_reasoning = extra.get("reasoning")
        if strip_reasoning:
            pass
        elif reasoning_effort == "off":
            # `off` is ABSOLUTE (final foreign review, F1): a merged `reasoning` namespace — per-call OR
            # endpoint-hand-set — must never silently RE-ENABLE reasoning. The old tail only popped the
            # top-level `reasoning_effort` kwarg when the namespace was non-empty, so an endpoint's
            # `reasoning: {effort: high}` / `{enabled: true}` / `{max_tokens: N}` overrode the `off`
            # request. So: prune EVERY control (`effort`/`max_tokens`/`enabled`) from the namespace; if
            # response-shape flags survive (e.g. `exclude`), carry the off signal INSIDE the namespace as
            # `effort: "none"` — OpenRouter documents top-level `reasoning_effort` as shorthand for
            # `reasoning.effort`, so this is the same wire meaning, unambiguous — and drop the top-level
            # kwarg; if the namespace empties, drop it and keep today's top-level `reasoning_effort:
            # "none"`. The mandatory-reasoning 400 on `"none"` stays covered by the D46 marker (no change).
            if isinstance(merged_reasoning, dict):
                kept = {k: v for k, v in merged_reasoning.items() if k not in _REASONING_NS_CONTROL_KEYS}
                if kept:
                    kept["effort"] = "none"
                    extra["reasoning"] = kept
                    out.pop("reasoning_effort", None)
                else:
                    extra.pop("reasoning", None)
            # F2 — the `reasoning_effort` shorthand can ALSO ride in the endpoint's own extra_body; evict
            # it so a stale re-enabling value can't survive an `off` request (supersedes the F2 rule below).
            extra.pop("reasoning_effort", None)
        elif isinstance(merged_reasoning, dict) and merged_reasoning:
            # The mutual-exclusion guarantee has to survive an endpoint that hand-set `reasoning` itself
            # (audit FIX 2 + final foreign review F2) — otherwise both spellings ride in one request, the
            # exact hard 400 this dialect exists to prevent. Three rules, all "the per-call budget wins":
            #   1. within the object, a `max_tokens` evicts any `effort`;
            #   2. a non-empty `reasoning` object suppresses the top-level `reasoning_effort` kwarg (`out`);
            #   3. …AND the same OpenRouter shorthand hand-set in the endpoint's `extra_body` (F2) — e.g.
            #      `extra_body: {reasoning_effort: high}` + per-call `reasoning_tokens` used to emit BOTH
            #      `reasoning_effort` and `reasoning.max_tokens`, the exact D45 hard-400 pair.
            if "max_tokens" in merged_reasoning and "effort" in merged_reasoning:
                merged_reasoning = {k: v for k, v in merged_reasoning.items() if k != "effort"}
                extra["reasoning"] = merged_reasoning
            out.pop("reasoning_effort", None)
            extra.pop("reasoning_effort", None)
        if extra:
            out["extra_body"] = extra
        return out

    def _resolve_chain(self, mode: str | None, model_override: str | None) -> list[_ChainEntry]:
        """The failover chain with the per-entry model resolved: the override applies to the *selected*
        (index 0) endpoint only; every fallback uses its own configured model."""
        return [
            (name, ep, (model_override if idx == 0 else None) or ep.model)
            for idx, (name, ep) in enumerate(self._cfg.endpoint_chain(mode))
        ]

    @staticmethod
    def _chunk_deltas(chunk: Any, pending: dict[int, dict[str, str]]) -> list[ChatDelta]:
        """Process one raw stream chunk → the `ChatDelta`s to yield, accumulating tool-call fragments
        (index-keyed id/name/arguments) into `pending`. Shared by the first probed chunk + the rest."""
        out: list[ChatDelta] = []
        if not chunk.choices:
            return out
        delta = chunk.choices[0].delta
        if delta is None:
            return out
        # Thinking models stream chain-of-thought separately; field name varies by server, so check
        # the typed attr and the SDK's passthrough `model_extra`.
        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning is None and getattr(delta, "model_extra", None):
            reasoning = delta.model_extra.get("reasoning_content") or delta.model_extra.get("reasoning")
        if reasoning:
            out.append(ChatDelta(reasoning=reasoning))
        if delta.content:
            out.append(ChatDelta(text=delta.content))
        for tc in delta.tool_calls or []:
            slot = pending.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function and tc.function.name:
                slot["name"] = tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments
        return out

    @staticmethod
    def _capture_cache_telemetry(chunk: Any, report: StreamReport | None) -> None:
        """Read prompt-cache telemetry off one stream chunk into `report` (ACA-18), wherever the
        endpoint reports it — cheap attribute reads, only the final chunk carries anything. Never
        raises + never issues an extra request; a field the backend didn't send just stays `None`.

        - OpenAI-style (cloud): the final chunk carries `usage` when `stream_options.include_usage`
          was sent — `usage.prompt_tokens` + `usage.prompt_tokens_details.cached_tokens`. (Note:
          OpenAI reports `cached_tokens == 0` below 1024 prompt tokens — that is the documented floor,
          not a cache failure.)
        - llama.cpp: non-standard `timings` (`prompt_n`/`cache_n`) or streaming `prompt_progress`
          (`total`/`cache`, gated on the endpoint's `return_progress`) ride the SDK passthrough
          `model_extra`."""
        if report is None:
            return
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            pt = getattr(usage, "prompt_tokens", None)
            if isinstance(pt, int):
                report.prompt_tokens = pt
            details = getattr(usage, "prompt_tokens_details", None)
            ct = getattr(details, "cached_tokens", None)
            if isinstance(ct, int):
                report.cached_tokens = ct
        extra = getattr(chunk, "model_extra", None)
        if not isinstance(extra, dict):
            return
        timings = extra.get("timings")
        if isinstance(timings, dict):
            pn, cn = timings.get("prompt_n"), timings.get("cache_n")
            if isinstance(pn, int):
                report.prompt_tokens = pn
            if isinstance(cn, int):
                report.cached_tokens = cn
        progress = extra.get("prompt_progress")
        if isinstance(progress, dict):
            total, cache = progress.get("total"), progress.get("cache")
            if isinstance(total, int):
                report.prompt_tokens = total
            if isinstance(cache, int):
                report.cached_tokens = cache

    def _maybe_notice_anchoring_inactive(self, report: StreamReport | None) -> None:
        """R4 (D42): once per client instance, INFO-log that context anchoring is inactive for this
        endpoint when a COMPLETED stream reported no prompt-token total (`report.prompt_tokens is None`).
        Without a total the anchored estimator falls back to the chars/4 heuristic silently, so name the
        exact remedy per backend. Called only after a stream drains cleanly (never on a mid-stream
        error); guarded so the emitted case short-circuits to two cheap comparisons on the hot path."""
        if report is None or report.prompt_tokens is not None or self._anchoring_notice_emitted:
            return
        self._anchoring_notice_emitted = True
        log.info(
            "context anchoring inactive for endpoint '%s': the completed stream reported no prompt-token "
            "total, so compaction falls back to the heuristic context estimate. Enable it with "
            "extra_body={'return_progress': true} (local llama.cpp) or "
            "stream_options={'include_usage': true} (cloud).",
            report.served or "?",
        )

    def _record(self, report: StreamReport | None, chain: list[_ChainEntry], result: Any) -> None:
        if report is not None:
            served = chain[result.served_index]
            report.served = served[0]
            # D42: stamp the endpoint OBJECT that actually answered — the session prices iteration 2+'s
            # window trigger against it (window + anchor from the same serve). One-line chokepoint add.
            report.served_endpoint = served[1]
            report.degraded = result.degraded
            report.failures = result.failures

    async def complete(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
        reasoning_tokens: int | None = None,
        report: StreamReport | None = None,
    ) -> str:
        """Buffered (non-streaming) completion — used by the compactor's summarizer (4e), which wants
        the whole text at once. `mode`/`model` override the configured endpoint + model (the summarizer
        is separately selectable, D11). `max_tokens`/`reasoning_effort` are the modeled per-call config
        (D42/A10) threaded as first-class kwargs via `_call_config` — so the summarizer finally runs
        output-capped when its `ModelRef.max_tokens` is set. Walks the failover chain (buffered: each
        attempt returns the text). Raises `InferenceError` if every endpoint fails / none configured."""
        chain = self._resolve_chain(mode, model)
        if not chain:
            raise InferenceError("no inference endpoint configured")
        last_error: InferenceError | None = None

        async def attempt(entry: _ChainEntry) -> str:
            nonlocal last_error
            name, ep, use_model = entry
            if not use_model:
                raise InferenceError(f"no model configured for '{name}'")
            # D40 rider: gate this endpoint per-attempt (the endpoint actually being called, inside the
            # failover chain — never around it). Buffered call: hold the permit for the whole request
            # and release in `finally`. The summarizer runs here AFTER the parent turn's stream closed
            # (its permit already released), so it never deadlocks against the parent at limit 1.
            sem = self._sem_for(ep)
            if sem is not None:
                await sem.acquire()

            async def _once(strip: bool) -> str:
                # We carry messages as our own `list[dict]` (OpenAI wire shape, built across the
                # loop); cast to the SDK's param type at this boundary rather than retyping the whole
                # loop. `_call_config` supplies the per-endpoint modeled params (max_tokens field
                # name, reasoning_effort) + the merged `extra_body` (ACA-18 cache pin + the "off"
                # chat_template_kwargs), so the pin/config never leaks across the failover chain.
                resp = await self._client(ep).chat.completions.create(
                    model=use_model,
                    messages=cast("list[ChatCompletionMessageParam]", messages),
                    stream=False,
                    **self._call_config(
                        ep,
                        max_tokens=max_tokens,
                        reasoning_effort=reasoning_effort,
                        reasoning_tokens=reasoning_tokens,
                        strip_reasoning=strip,
                    ),
                )
                if not resp.choices:
                    raise InferenceError("inference returned no choices")
                return resp.choices[0].message.content or ""

            try:
                try:
                    # D46: exactly ONE stripped re-attempt, INSIDE this hop — see `stream_chat.attempt`
                    # for the full rationale (no failover hop, no transient-retry attempt, same permit).
                    stripped = self._reasoning_is_demoted(ep, use_model)
                    try:
                        return await _once(stripped)
                    except BaseException as exc:
                        if stripped or not self._note_reasoning_demotion(
                            exc,
                            name=name,
                            ep=ep,
                            model=use_model,
                            reasoning_effort=reasoning_effort,
                            reasoning_tokens=reasoning_tokens,
                        ):
                            raise
                    return await _once(True)
                except BaseException as exc:
                    # D42: capture the OpenAI-SDK code/status pre-flattening (see `_as_inference_error`).
                    converted = _as_inference_error(exc)
                    if converted is not None:
                        last_error = converted
                        raise converted from exc
                    raise
            finally:
                if sem is not None:
                    sem.release()

        try:
            # Buffered path: no retry policy (D43 — the retry tier is CHAT-STREAM only; the summarizer
            # is latency-bound + has its own fallback semantics). `failover_collect` drains the generator
            # and returns the result, reducing byte-for-byte to today's straight next-hop walk.
            result = await failover_collect(chain, attempt, label=lambda e: e[0])
        except FailoverError as exc:
            raise InferenceError(
                str(exc),
                code=last_error.code if last_error is not None else None,
                status=last_error.status if last_error is not None else None,
                # D43/A4: how many endpoints the chain walked-and-failed — the routing machine's
                # single-endpoint-vs-total-outage discriminator (one failed hop = countable worker
                # failure; >1 = infra outage, excluded). Post-flattening this is the only survivor.
                endpoints_tried=len(exc.failures),
            ) from exc
        self._record(report, chain, result)
        return result.value

    async def stream_chat(
        self,
        messages: list[dict],
        *,
        mode: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        reasoning_effort: str | None = None,
        reasoning_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
        report: StreamReport | None = None,
    ) -> AsyncIterator[ChatDelta | RetryNotice | FailoverNotice]:
        """Stream a chat completion as per-token `ChatDelta`s, failing over at **stream initiation** and
        interleaving typed control items (`RetryNotice`/`FailoverNotice`) BEFORE the first `ChatDelta`.

        `messages` is OpenAI shape; `tools` is the optional function toolset. `tool_choice` overrides
        the default policy when `tools` are present (`None` → today's `"auto"`; e.g. `"none"` keeps the
        toolset in the prompt for cache stability while forbidding calls — ACA-21). `mode`/`model`
        select + override the endpoint (an `AgentDef` picks its own backend+model, D11). Each chain
        endpoint is
        probed by opening the stream + pulling its first chunk; the first that produces a chunk wins
        (failover at init — no token has reached the user yet). After that we iterate the rest with no
        further failover: a mid-stream drop raises `InferenceError` (can't restart a partial reply). Tool
        calls arrive as index-keyed fragments, reassembled and emitted as one terminal
        `ChatDelta(tool_calls=[...])`.

        D43/A7: a genuinely-transient init failure (`categorize` = 429/503/Retry-After/llama.cpp busy)
        retries the SAME endpoint up to its resolved `retry_attempts` (visible `RetryNotice` + backoff)
        BEFORE hopping; a `FailoverNotice` narrates each hop. The permit-free backoff lives INSIDE the
        failover generator; the D42 first-chunk/permit-release scoping below is unchanged. Raises
        `InferenceError` if every endpoint fails / none configured.
        """
        chain = self._resolve_chain(mode, model)
        if not chain:
            raise InferenceError("no inference endpoint configured")
        kwargs: dict[str, Any] = {"messages": messages, "stream": True}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = tool_choice or "auto"
        last_error: InferenceError | None = None
        #: The hop the retry policy is deciding on (set by `attempt`, read by `_retry_policy` — the
        #: policy gets `(exc, attempt)` but not the endpoint, so `attempt` stashes it here) + the last
        #: classifier verdict (set in the policy, read when re-yielding a notice so it carries the tier).
        last_entry: _ChainEntry | None = None
        last_category: ErrorCategory = "other"

        def _retry_policy(exc: BaseException, done: int) -> FailAction:
            """D43/A7 — the CHAT-STREAM retry policy handed to `failover()`: `transient` errors retry the
            SAME endpoint (`base×2ⁿ`, `Retry-After`-floored, capped) while the hop's `retry_attempts`
            budget lasts; `fatal_for_endpoint`/`overflow`/`other` → straight next-hop (today's walk)."""
            nonlocal last_category
            last_category = categorize(exc)
            if last_entry is None or last_category != "transient":
                return NEXT_HOP
            budget = _resolve_retry_attempts(self._cfg, last_entry[1])
            if done >= budget:
                return NEXT_HOP
            return RETRY_AFTER(_retry_delay(done, getattr(exc, "retry_after", None)), budget)

        async def attempt(entry: _ChainEntry) -> tuple[Any, Any, asyncio.Semaphore | None]:
            nonlocal last_error, last_entry
            last_entry = entry  # for `_retry_policy`'s per-endpoint budget resolution
            name, ep, use_model = entry
            if not use_model:
                raise InferenceError(f"no model configured for '{name}'")
            # D40 rider: gate this endpoint per-attempt (the endpoint actually called, INSIDE the chain
            # — never around it). A streamed response holds its slot for the ENTIRE stream lifetime, so
            # the permit is HANDED to the consumer (returned as the 3rd tuple element) and released in
            # the outer generator's `finally` when the stream closes — NOT here. A failed attempt
            # (create error / dead first chunk / cancel during the probe) releases before failing over.
            sem = self._sem_for(ep)
            if sem is not None:
                await sem.acquire()

            async def _open(strip: bool) -> tuple[Any, Any]:
                # `_call_config` merges this endpoint's modeled params (max_tokens field name,
                # reasoning_effort) + its `extra_body` PER-ENDPOINT, never into the shared `kwargs` — an
                # OpenAI backend 400s on unknown args, so the local endpoint's `cache_prompt`/`return_progress`
                # must not leak onto the cloud hop (ACA-18; same discipline as voice.py's extra_body).
                call_kwargs = {
                    **kwargs,
                    **self._call_config(
                        ep,
                        max_tokens=max_tokens,
                        reasoning_effort=reasoning_effort,
                        reasoning_tokens=reasoning_tokens,
                        strip_reasoning=strip,
                    ),
                }
                stream = await self._client(ep).chat.completions.create(model=use_model, **call_kwargs)
                try:
                    first = await stream.__anext__()  # confirm the provider is alive + producing tokens
                except BaseException as exc:
                    # ANY first-read failure closes the backend stream BEFORE the permit is released
                    # by the outer handler below — incl. `CancelledError` (a BaseException; the old
                    # `except Exception` close let a cancel-during-probe leak the live generation) and
                    # the empty-stream case (Codex HIGH: close-before-release, see the finally below).
                    await _shielded_close(stream)
                    if isinstance(exc, StopAsyncIteration):
                        raise InferenceError("inference returned an empty stream") from exc
                    raise
                return first, stream

            try:
                # D46 — the reasoning-capability re-attempt lives HERE, inside one hop, and that placement
                # IS the design: `failover()` never sees the rejected attempt, so it is not a failover hop
                # (`FailoverError.failures`/`endpoints_tried` unchanged, no `FailoverNotice`) and never
                # reaches `_retry_policy`, so it cannot consume a transient `retry_attempts` budget meant
                # for a busy backend. The permit is untouched: it was acquired above and is released by the
                # single handler below (failure) or handed to the consumer (success) — a stripped
                # re-attempt is just a second `create()` under the SAME permit, exactly like the first.
                # Bounded to ONE PER HOP by construction: the second call passes `strip=True` and can
                # never re-enter (`_note_reasoning_demotion` is skipped when `stripped`). Per-hop, not
                # per-request, is the honest description (audit LOW-1): a chain whose endpoints ALL
                # reject reasoning pays one extra call per endpoint on the FIRST request, then zero —
                # each hop must learn its own `(endpoint, model)` capability, and a demotion learned on
                # the local endpoint says nothing about the cloud one.
                stripped = self._reasoning_is_demoted(ep, use_model)
                try:
                    first, stream = await _open(stripped)
                except BaseException as exc:
                    if stripped or not self._note_reasoning_demotion(
                        exc,
                        name=name,
                        ep=ep,
                        model=use_model,
                        reasoning_effort=reasoning_effort,
                        reasoning_tokens=reasoning_tokens,
                    ):
                        raise
                    first, stream = await _open(True)
            except BaseException as exc:
                if sem is not None:
                    sem.release()  # permit not handed off → release before the next endpoint / raise
                # D42: capture the OpenAI-SDK code/status pre-flattening (a context-overflow 400 surfaces
                # here — at `create()`/first-chunk, before any token — so the reactive backstop can see
                # it once failover collapses the chain). `_as_inference_error` passes a cancellation /
                # existing InferenceError through unchanged.
                converted = _as_inference_error(exc)
                if converted is not None:
                    last_error = converted
                    raise converted from exc
                raise
            return first, stream, sem

        # Drive the failover GENERATOR (D43/A6): re-yield its control items as typed wire notices
        # BEFORE the first ChatDelta, capture the winning `FailoverResult` (the generator's last item).
        # The retry backoff/sleep lives INSIDE the generator (permit-free — see failover.py); this loop
        # only forwards the narration. `_retry_policy` drives the transient-retry tier.
        result: FailoverResult[tuple[Any, Any, asyncio.Semaphore | None]] | None = None
        try:
            async for item in failover(chain, attempt, label=lambda e: e[0], policy=_retry_policy):
                if isinstance(item, FailoverResult):
                    result = item  # the terminal item — the generator returns right after
                elif isinstance(item, HopRetry):
                    yield RetryNotice(
                        endpoint=chain[item.index][0],
                        attempt=item.attempt,
                        max_attempts=item.max_attempts,
                        delay_s=item.delay_s,
                        category=last_category,
                    )
                else:  # HopFailover
                    yield FailoverNotice(
                        from_endpoint=chain[item.from_index][0],
                        to_endpoint=chain[item.to_index][0],
                        category=last_category,
                    )
        except FailoverError as exc:
            raise InferenceError(
                str(exc),
                code=last_error.code if last_error is not None else None,
                status=last_error.status if last_error is not None else None,
                # D43/A4: how many endpoints the chain walked-and-failed — the routing machine's
                # single-endpoint-vs-total-outage discriminator (one failed hop = countable worker
                # failure; >1 = infra outage, excluded). Post-flattening this is the only survivor.
                endpoints_tried=len(exc.failures),
            ) from exc
        assert result is not None, "failover() drained without a FailoverResult and without raising"
        self._record(report, chain, result)

        first, stream, sem = result.value
        pending: dict[int, dict[str, str]] = {}
        try:
            self._capture_cache_telemetry(first, report)
            for delta in self._chunk_deltas(first, pending):
                yield delta
            async for chunk in stream:
                self._capture_cache_telemetry(chunk, report)
                for delta in self._chunk_deltas(chunk, pending):
                    yield delta
            if pending:
                yield ChatDelta(
                    tool_calls=[
                        ToolCallRequest(id=s["id"], name=s["name"], arguments=s["arguments"])
                        for _, s in sorted(pending.items())
                    ]
                )
            # The stream drained cleanly: telemetry capture has concluded, so this is the honest point
            # to notice a backend that never reported a prompt-token total (R4 — anchoring inactive).
            self._maybe_notice_anchoring_inactive(report)
        except InferenceError:
            raise
        except Exception as exc:  # noqa: BLE001 — a mid-stream error: normalize, no failover
            # Normalize + capture any SDK code/status (D42); a mid-stream drop can't overflow, but the
            # structured wrap is free and keeps ONE construction discipline.
            raise (_as_inference_error(exc) or InferenceError(str(exc))) from exc
        finally:
            # D40 rider — the crux: release the request slot when the STREAM closes, riding this
            # generator's own lifetime, NOT the opener's return. The stream is consumed here (yielded
            # upward), so the permit is held across the whole response and freed on exhaustion, on a
            # mid-stream error, or on consumer `aclose()`/GC. Callers (`session._drive`) fully drain
            # this `async for` BEFORE running any tool / subagent fan-out, so the permit is provably
            # released before tool execution — no completion ever holds a slot across tools (no
            # hold-and-wait → no deadlock at limit 1, pinned by `test_inference_gate_d40`).
            #
            # CLOSE-BEFORE-RELEASE (Codex HIGH, 2026-07-19): on `aclose()`/cancel the backend is still
            # GENERATING — an abandoned stream occupies the real llama.cpp slot, so releasing the
            # permit first would admit a second request while the backend is busy, defeating
            # `max_concurrent_requests` exactly where it matters. Close to completion (shielded, so a
            # cancel can't interrupt the close and free the permit early), THEN release — the nested
            # finally guarantees the release even if the close path re-raises the in-flight cancel.
            try:
                await _shielded_close(stream)
            finally:
                if sem is not None:
                    sem.release()


async def _safe_close(stream: Any) -> None:
    """Best-effort close of an OpenAI stream that broke during the first-chunk probe."""
    try:
        await stream.close()
    except Exception:  # noqa: BLE001 — closing a broken stream is best-effort
        pass


async def _shielded_close(stream: Any) -> None:
    """Drive `_safe_close` to COMPLETION even under cancellation (Codex HIGH, 2026-07-19 — the D40
    request gate's close-before-release rule). An abandoned/cancelled stream still occupies the real
    backend slot until the HTTP response is closed, so the close must LAND before the caller releases
    the endpoint permit; an unshielded `await` here could be interrupted by the very cancel that
    triggered the cleanup, freeing the permit while the backend keeps generating. Same retained-task +
    `asyncio.shield` + second-await discipline as the session's `_persist_shielded` (both cancellation
    shapes defeated); `_safe_close` itself never raises, so the only re-raise out of here is an
    in-flight `CancelledError` — which the caller's release path must (and does) tolerate."""
    task = asyncio.ensure_future(_safe_close(stream))
    with anyio.CancelScope(shield=True):
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task  # the inner task is uncancellable by the outer cancel — let it finish
            raise
