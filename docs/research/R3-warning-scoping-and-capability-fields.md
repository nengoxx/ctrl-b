# R3 — Where a role-specific warning belongs · declared capability vs wire dialect

**Date:** 2026-07-25 · **Drove:** the api_mode advisory fix (open) + the `openai/tts` question ·
**Status:** evidence, not a decision · **Coverage:** partial — this dossier answers the
*warning-scoping* question and the *capability-vs-dialect* question. The **provider auto-naming**
question (R3's original part D) was **not bought** — the pass was stopped on budget.

Field pass over Kubernetes, Terraform, ESLint/typescript-eslint, OpenTelemetry Collector, LiteLLM,
Spectral, JSON Schema/OpenAPI, systemd, nginx, ansible-lint, Helm, kubeconform, KubeLinter, plus the
static-analysis false-positive literature. All quotes from primary docs or source (the pass's
WebSearch budget ran out partway; the remainder was direct fetch/curl/GitHub API, so nothing here is
search-snippet-derived).

---

## 1. The verdict

The dominant practice is a **two-layer split**:

- **Layer 1 — declaration-time, in isolation: intrinsic validity only.** Types, required fields,
  formats, and mutually-exclusive siblings *within the same block*. Cheap, offline, always runs.
- **Layer 2 — role/consumer-specific semantics: at the reference/use site**, *or* discriminated on a
  field the declaration itself carries.

The tiebreaker is one question, and every ecosystem answers it identically:

> **Does the declaration itself contain the discriminant that proves the field is consumed?**
> If **yes** → branch on it — and prefer a hard **error** over a warning.
> If **no** → warn at the **reference site**. Warning at declaration is by definition a warning on
> *suspected* non-use, and the universal rule is: **warn only on proven inertness, never on suspected
> inertness.**

## 2. Evidence

### Kubernetes

**When the discriminator is in the same object, k8s doesn't warn — it rejects.**
([`pkg/apis/core/validation/validation.go`](https://github.com/kubernetes/kubernetes/blob/master/pkg/apis/core/validation/validation.go))

```
field.Forbidden(fieldPath, "may only be used when `type` is 'LoadBalancer'")   // loadBalancerSourceRanges
field.Forbidden(portPath.Child("nodePort"), "may not be used when `type` is 'ClusterIP'")
"may only be set when `type` is 'LoadBalancer' and `externalTrafficPolicy` is 'Local'"  // healthCheckNodePort
```

**Warnings are reserved for provable inertness** ([`pkg/api/pod/warnings.go`](https://github.com/kubernetes/kubernetes/blob/master/pkg/api/pod/warnings.go)) —
every entry is "you set X; X provably has no effect, here's why":
`hostIP set without hostPort` · `a null labelSelector results in matching no pod`. These run inside
`GetWarningsForPod`, i.e. **the object's role is already known**.

**Deprecation is explicitly *use*-triggered** ([deprecation-policy](https://github.com/kubernetes/website/blob/main/content/en/docs/reference/using-api/deprecation-policy.md)):
*"Rule #6: Deprecated CLI elements must emit warnings (optionally disable) **when used**"*;
*"Rule #10: Deprecated feature gates must respond with a warning **when used**."* Emitted per request
to the deprecated endpoint, never by scanning stored objects.

**When the interpreting consumer is pluggable, k8s validates nothing about the payload** — the exact
structural twin of our problem. StorageClass `parameters` is opaque to the API server ("*parameters
holds the parameters for the provisioner*"); IngressClass: *"**The specific type of parameters to use
depends on the ingress controller** that you specify in the `.spec.controller` field."* A
non-matching Ingress is **silently ignored**, not warned about.

### Terraform

- **An unused declaration is not a diagnosable condition.** No "declared but not used" diagnostic
  exists; [#11412](https://github.com/hashicorp/terraform/issues/11412) has been open since **Jan
  2017**. Unused-declaration linting is deliberately third-party (tflint).
- **Unreferenced providers are pruned before validation or configuration**, and the in-source
  rationale is the whole thesis: *"PruneProviderTransformer removes any providers that are not
  actually used by anything… This both saves resources but also **avoids errors since configuration
  may imply initialization which may require auth**."*
- **The same condition gets three severities depending on whether context implies intent**
  (`unparsed_value.go`): CLI `-var` → **error**; `.tfvars` → **warning, capped at 2**; env var →
  **silent**, because *"we presume that they are being set in the session with the intent of ignoring
  them when they are not relevant."*
- **Placement is decided by message clarity** ([Custom Conditions](https://developer.hashicorp.com/terraform/language/expressions/custom-conditions)):
  *"it can be pragmatic to declare one postcondition on that resource rather than preconditions on
  each dependency."*

### OpenTelemetry Collector — the closest structural twin (declare vs reference)

Repeated verbatim for every component class
([config docs](https://opentelemetry.io/docs/collector/configuration/)):

> **"Configuring a receiver does not enable it.** Receivers are enabled by adding them to the
> appropriate pipelines within the service section."

And the code enforces exactly one direction ([`otelcol/config.go`](https://github.com/open-telemetry/opentelemetry-collector/blob/main/otelcol/config.go)):

```go
return fmt.Errorf("service::pipelines::%s: references receiver %q which is not configured", ...)
```

**Dangling reference → hard error. Declared-but-unreferenced → inert, silent.** Adopt this asymmetry
regardless of anything else.

### The declared-capability precedent — LiteLLM

`model_info.mode` ∈ `{chat, completion, embedding, audio_transcription, audio_speech,
image_generation, rerank, batch, realtime, ocr, video_generation}`, used to point the health prober
at the right API surface. **Note it is a role/capability field deliberately kept *separate* from the
vendor/dialect prefix in `litellm_params.model`.** Its fallback (*auto-detect, fall back to chat
completion*) is a **health-probe default, not a warning trigger** — don't borrow it as one.

Same shape elsewhere: **Spectral** `formats` (`oas2`/`oas3`) means a wrong-dialect rule *doesn't fire
at all* · **kubeconform** picks the schema from `{{.ResourceKind}}` and ships
`-ignore-missing-schemas` so unknown kinds can't manufacture findings · **OpenAPI `discriminator`**,
whose entire payoff per [Ajv](https://ajv.js.org/json-schema.html) is *report quality* — "*removing
discriminator will not change the validity of the data, but errors reported… will be different*."

### systemd — three outcomes, three severities, keyed on declared `Type=`

- **Refuse:** *"Service has Restart= set to either always or on-success, which isn't allowed for
  Type=oneshot services. Refusing."*
- **Warn (legal but provably inert):** *"RuntimeMaxSec= has no effect in combination with
  Type=oneshot. Ignoring."*
- **Warn + ignore (unknown key):** *"Unknown key '%s' in section [%s], ignoring."*

**Every warning names the discriminant that causes the inertness. systemd never warns speculatively.**

### nginx / ESLint / ansible-lint

- **nginx:** validity is a function of the enclosing consumer (every directive has a **Context:**);
  it distinguishes *"unknown directive"* from *"not allowed here"*, and **a declared-but-unreferenced
  `upstream` block is silently accepted**. It warns only about provable shadowing.
- **ESLint:** `warn` is *defined* as the severity for uncertainty — *"when a rule cannot determine
  with certainty that a problem has been found."* And the canonical fix for "this rule can't apply
  here" is to **turn it off for those files** (`tseslint.configs.disableTypeChecked`), not to soften it.
- **ansible-lint:** `skip_list` is discouraged in favour of `.ansible-lint-ignore`, because ignored
  violations stay *"still visible, making it easier to address later."*

## 3. Warning fatigue — why a mis-scoped advisory is actively harmful

**Sadowski et al., "Lessons from Building Static Analysis Tools at Google," CACM 61(4) 2018**
([DOI 10.1145/3188720](https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/)):

> "We consider an issue to be an **'effective false positive' if developers did not take positive
> action after seeing the issue**… If an analysis reports an actual fault, but the developer did not
> understand the fault and therefore took no action, that is an effective false positive."

> "**Developers, not tool authors, will determine and act on a tool's perceived false-positive rate.**"

Tricorder **auto-disables** an analyzer whose not-useful ratio exceeds 10%. On the FindBugs rollback:
*"the presence of effective false positives caused developers to lose confidence in the tool."*

**Bessey et al., "A Few Billion Lines of Code Later," CACM 53(2) 2010**
([DOI 10.1145/1646353.1646374](https://cacm.acm.org/research/a-few-billion-lines-of-code-later/)):

> "False positives do matter… People ignore the tool. True bugs get lost in the false. **A vicious
> cycle starts where low trust causes complex bugs to be labeled false positives, leading to yet
> lower trust.** … We initially thought false positives could be eliminated through technology.
> Because of this dynamic we no longer think so."

Corroborating: **Go** wires only *"a high-confidence subset of the default go vet checks"* into
`go test`; **Clippy**'s `correctness` is the only deny-by-default group and is *"carefully picked and
should be free of false positives."*

## 4. Implication for ctrl-b (our reading — ages faster than the evidence)

**`api_mode` is a wire dialect, not a role.** `openai` on a speaches endpoint is a *correct,
intentional* declaration. Firing a chat-specific advisory against it is precisely the move nginx,
systemd, Terraform and the Collector all refuse: **warning on suspected non-use rather than proven
inertness.** Under Google's definition it is an *effective false positive* — the owner takes no
action — and under Bessey's it seeds the trust death-spiral, where the whole class of warning stops
being read.

**Recommended (option ii) — move the advisory to the `inference` section that references the
provider.** Pure "warn at the use site." Zero false positives by construction: it fires exactly when a
chat consumer will actually send `reasoning_effort` to that endpoint. **No schema change, no new
field, no migration** — which matters under the standing extend-don't-migrate directive: it adds no
dimension at all. Message shape should follow systemd's — name **both** the setting and the
discriminant. One provider referenced by two chat roles should warn **once** (kubectl-style dedupe).

**On `openai/tts` (option i) — legitimate as a *later, separate* step, never as this fix.** A declared
capability field is the dominant pattern *when the discriminant lives in the same object* (k8s
`spec.type`, systemd `Type=`, Spectral `formats`, LiteLLM `model_info.mode`) — but note that in every
one of those it is a **field beside the dialect, never fused into it**. Two further conditions the
precedent imposes: it must be **required or reliably defaulted** (an optional `kind` most users omit
reintroduces guessing), and once the discriminant is present, "chat-only field set on a non-chat
provider" becomes *provable* — and the precedent says provable ⇒ **reject, don't warn**. That's a
breaking change, so it belongs behind a deliberate D-entry, not a bug-fix slice.

**Avoid:** keeping the advisory at declaration time and suppressing it per-provider. That's the
`skip_list` anti-pattern; it leaves the false positive in the model and adds a knob to hide it.

**Adopt regardless — the asymmetry every system agrees on:** a section referencing an **undeclared**
provider is a **hard error**; a declared provider referenced by **nobody** is **silent**.

### The one-line principle worth recording

> **Warn only where the feature is consumed, and only about inertness you can prove.** Validate a
> declaration in isolation for intrinsic validity; validate references for existence; put
> role-specific advisories at the reference site — unless the declaration carries a *required*
> discriminant, in which case branch on it and prefer an error over a warning.

## 5. Gaps

- **Provider auto-naming (the original part D) was never researched** — the pass was stopped on
  budget. Still owed: how systems name auto-created entries from a URL (HA discovery naming from
  mDNS/SSDP device names, Grafana datasources, Docker Compose, Terraform import), and whether anything
  derives a name from what a server *says* it is.
- The CACM Google paper 403'd on direct fetch; quotes come from the open-access PDF via DOI.
- `kubernetes/community` `api-conventions.md` contains **no** warnings guidance (0 hits for "warn"
  across 2231 lines) — worth knowing if anyone cites it here. The real contract is KEP-1693 +
  `extensible-admission-controllers.md` + `deprecation-policy.md`.
- Not covered: Pydantic/Zod discriminated unions as a code-level analogue, Prometheus/Alertmanager
  config validation, Compose unknown-key handling.
