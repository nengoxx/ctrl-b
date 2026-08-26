/* =====================================================================
   CTRL/B — ALT FLEET LAB · THE FINALISTS · app.js
   Three immersive concept screens, one mock roster, no framework.

   The harness (1–5, 7) is lab v2's, trimmed to what three screens need.
   The concept builders (6) are new: A THE POSTER, B THE COVER,
   C THE CLUB PAGE — the survivors of the 2026-08-08 kill/keep/harvest
   walk (GACHA_PLAN §12.5, rulings log).

   Modules, in order:
     1  roster data + derivations (incl. the RARITY -> HUE ladder)
     2  tiny DOM helper
     3  wake store (per-concept local state)
     4  ceremony engine (R24 B.3: 5 beats <=900ms, tap-anywhere-skips)
     5  shared dossier
     5b shared PICKUP BANNER MOCK (the faithfulness directive)
     6  concept builders A / B / C
     7  switcher + boot
   ===================================================================== */
(() => {
"use strict";

/* ---------------------------------------------------------------------
   1 · ROSTER — the same four machines in every concept.
   Byte-identical to lab v2's roster so the three labs agree.
   ------------------------------------------------------------------ */
const ART = "./assets";

const ROSTER = [
  {
    id:"pegasus", name:"Pegasus", jp:"天馬", role:"WORKSTATION",
    epithet:"the Winged Furnace",
    status:"ONLINE", stars:5, ping:"18 ms", seen:"now", uptime:"41d 06h",
    host:"PEGASUS-01", vendor:"CUSTOM / AM5", serial:"004-ζ",
    art:`${ART}/pegasus.webp`, focus:"50% 26%",
    services:["Hermes","ComfyUI","Open WebUI","File relay","Speaches"]
  },
  {
    id:"atlas", name:"Atlas", jp:"地図", role:"HOME SERVER",
    epithet:"the Patient Shoulder",
    status:"ONLINE", stars:4, ping:"7 ms", seen:"now", uptime:"128d 19h",
    host:"ATLAS-HOME", vendor:"SUPERMICRO", serial:"011-β",
    art:`${ART}/atlas.webp`, focus:"50% 26%",
    services:["Storage","Backups","Jellyfin","Home bridge"]
  },
  {
    id:"rook", name:"Rook", jp:"塔", role:"MINI NODE",
    epithet:"the Sleeping Tower",
    status:"SLEEPING", stars:2, ping:"—", seen:"2h ago", uptime:"—",
    host:"ROOK-MINI", vendor:"INTEL NUC", serial:"027-δ",
    art:`${ART}/3.webp`, focus:"50% 22%",
    services:["Wake relay","Build runner"]
  },
  {
    id:"lyra", name:"Lyra", jp:"琴", role:"MEDIA VAULT",
    epithet:"the Silent Chorus",
    status:"ONLINE", stars:3, ping:"12 ms", seen:"now", uptime:"12d 03h",
    host:"LYRA-VLT", vendor:"SYNOLOGY", serial:"048-λ",
    art:`${ART}/4.webp`, focus:"50% 8%",
    services:["Media","Archive","Sync"]
  }
];

/* --- THE RARITY -> HUE LADDER (owner ruling, 2026-08-08) -------------
   Slice / panel / cover accent derives from the STAR COUNT, not from a
   hand-picked per-host colour.  Production's source is the configured-
   services ladder in `frontend/src/themes/gacha/stars.ts`; the lab's mock
   roster carries `stars` directly, which is the same number.
   5 gold (== production --gc-star) · 4 purple · 3 cyan · 2 green · 1 silver floor.
   ------------------------------------------------------------------ */
const RARITY_HUE = {
  1:"#cdd2e0",  /* silver floor */
  2:"#5fe0a0",  /* green        */
  3:"#4dd7ff",  /* cyan         */
  4:"#b07cff",  /* purple       */
  5:"#ffd464"   /* gold         */
};
const hueOf = u => RARITY_HUE[u.stars] || RARITY_HUE[1];

/* Stars keep the PRODUCTION star grammar and are independent of the slice
   hue: gold fill, rose-gold for the top two rungs (stars.ts `isHighStar`,
   5-star mode).  A star row is never tinted by rarity — that would make two
   different signals wear the same colour. */
const STAR_MAX = 5, STAR_HI_FROM = STAR_MAX - 2;   /* indices 3,4 are rose-gold */
function starRow(n, cls){
  const row = h("span", { class:"stars" + (cls ? " " + cls : ""), "aria-hidden":"true" });
  for (let i = 0; i < STAR_MAX; i++){
    const on = i < n;
    row.append(h("i", { class:"st" + (on ? (i >= STAR_HI_FROM ? " hi" : "") : " off") }, "★"));
  }
  return row;
}

const labelFor = u =>
  `${u.name}, ${u.role.toLowerCase()}, ${u.stars} stars, ` +
  (u.status === "ONLINE" ? "online. Opens the unit dossier." : "sleeping. Runs the wake sequence.");

/* A is SELECT-THEN-OPEN (owner ruling, round 2), so its labels have to name
   BOTH steps — a two-step control whose label promises one step is a trap
   for anyone who cannot see the selected nudge. */
const labelPoster = (u, isSelected) => {
  const what = u.status === "ONLINE" ? "open the unit dossier" : "run the wake sequence";
  const head = `${u.name}, ${u.role.toLowerCase()}, ${u.stars} stars, ${u.status.toLowerCase()}. `;
  return isSelected ? `${head}Selected. Tap to ${what}.`
                    : `${head}Tap to select; tap again to ${what}.`;
};

const labelCover = (u, isHero) => isHero
  ? `${u.name}, ${u.role.toLowerCase()}, ${u.stars} stars, on the cover, ` +
    (u.status === "ONLINE" ? "online. Opens the unit dossier." : "sleeping. Develops the cover and wakes it.")
  : `${u.name}, ${u.role.toLowerCase()}, ${u.stars} stars, ${u.status.toLowerCase()}. ` +
    `Supporting cut-in. Puts it on the cover.`;

/* ---------------------------------------------------------------------
   2 · DOM helper
   ------------------------------------------------------------------ */
function h(tag, attrs, ...kids){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()){
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const $ = sel => document.querySelector(sel);
/* restart a CSS animation class */
function replay(el, cls){
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------------
   3 · WAKE STORE — per-concept local state, so each screen walks fresh
   ------------------------------------------------------------------ */
const wake = {
  map: Object.create(null),
  isAwake(conceptId, unitId){ return !!this.map[conceptId + "/" + unitId]; },
  set(conceptId, unitId){ this.map[conceptId + "/" + unitId] = true; },
  clear(){ this.map = Object.create(null); }
};
function unitsFor(conceptId){
  return ROSTER.map(u =>
    u.status === "SLEEPING" && wake.isAwake(conceptId, u.id)
      ? { ...u, status:"ONLINE", ping:"31 ms", seen:"now", uptime:"0d 00h" }
      : u);
}

/* ---------------------------------------------------------------------
   4 · CEREMONY ENGINE — R24 §B.3
   Five beats, <=900ms, and tapping ANYWHERE collapses to the final frame.
   ------------------------------------------------------------------ */
const stageEl = $("#stage");
let ceremonyBusy = false;

function runCeremony(scopeEl, beats, total = 900){
  if (ceremonyBusy) return Promise.resolve(false);
  ceremonyBusy = true;
  const k = reduced() ? 0.22 : 1;
  const steps = beats.map(b => ({ at:b[0], fn:b[1], ran:false }));

  return new Promise(resolve => {
    const catcher = h("div", { class:"skip-catcher" });
    stageEl.appendChild(catcher);
    const timers = [];
    let done = false;

    const fire = s => { if (!s.ran){ s.ran = true; try { s.fn(); } catch (e){ console.error(e); } } };
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      catcher.remove();
      scopeEl.classList.remove("skip");
      ceremonyBusy = false;
      resolve(true);
    };
    const skip = () => {
      if (done) return;
      timers.forEach(clearTimeout);
      scopeEl.classList.add("skip");
      steps.forEach(fire);
      setTimeout(finish, 60);
    };
    catcher.addEventListener("pointerdown", skip);
    steps.forEach(s => timers.push(setTimeout(() => fire(s), s.at * k)));
    timers.push(setTimeout(finish, total * k));
  });
}

/* will-change hygiene: on during animation, off after (R24 B.5-4) */
stageEl.addEventListener("animationstart", e => {
  if (e.target instanceof HTMLElement) e.target.style.willChange = "transform, opacity";
}, true);
["animationend","animationcancel"].forEach(ev =>
  stageEl.addEventListener(ev, e => {
    if (e.target instanceof HTMLElement) e.target.style.willChange = "";
  }, true));

/* ---------------------------------------------------------------------
   5 · SHARED DOSSIER — one component, re-skinned per concept
   ------------------------------------------------------------------ */
const dsr = {
  layer: $("#dossier-layer"), card: $("#dsr"), img: $("#dsr-img"),
  name: $("#dsr-name"), epithet: $("#dsr-epithet"), role: $("#dsr-role"),
  stars: $("#dsr-stars"), rows: $("#dsr-rows"), serial: $("#dsr-serial"),
  status: $("#dsr-status"), go: $("#dsr-go"), close: $("#dsr-close"),
  backdrop: $("#dsr-backdrop"), opener: null, keyHandler: null
};

function openDossier(u, opts = {}){
  const { accent = hueOf(u), skin = "soft" } = opts;
  dsr.opener = document.activeElement;
  dsr.layer.style.setProperty("--dsr-accent", accent);
  dsr.layer.dataset.skin = skin;
  dsr.img.src = u.art;
  dsr.img.style.setProperty("--focus", u.focus);
  dsr.img.alt = "";
  dsr.img.classList.toggle("asleep", u.status !== "ONLINE");
  dsr.name.textContent = u.name;
  dsr.epithet.textContent = u.epithet;
  dsr.role.textContent = u.role;
  dsr.stars.replaceChildren(starRow(u.stars));
  dsr.serial.textContent = `FILE NO. ${u.serial} · ${u.host}`;
  dsr.status.textContent = "SIMULATED — NO REAL HOST";
  dsr.rows.replaceChildren(
    ...[["HOSTNAME", u.host], ["STATUS", u.status], ["RARITY", `${u.stars}★`],
        ["UPTIME", u.uptime], ["PING", u.ping], ["LAST SEEN", u.seen],
        ["VENDOR", u.vendor], ["SERVICES", u.services.join(" · ")]]
      .flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])
  );
  dsr.layer.hidden = false;
  dsr.card.setAttribute("aria-label", `${u.name} dossier`);
  requestAnimationFrame(() => dsr.close.focus());

  dsr.keyHandler = e => {
    if (e.key === "Escape"){ e.preventDefault(); closeDossier(); return; }
    if (e.key !== "Tab") return;
    const f = [...dsr.card.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])")]
      .filter(n => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", dsr.keyHandler, true);
  announce(`${u.name} dossier open. ${u.epithet}. ${u.status}.`);
}

function closeDossier(){
  if (dsr.layer.hidden) return;
  dsr.layer.hidden = true;
  document.removeEventListener("keydown", dsr.keyHandler, true);
  dsr.keyHandler = null;
  if (dsr.opener && dsr.opener.isConnected) dsr.opener.focus();
  dsr.opener = null;
}
dsr.close.addEventListener("click", closeDossier);
dsr.backdrop.addEventListener("click", closeDossier);
dsr.go.addEventListener("click", () => {
  dsr.status.textContent = "TERMINAL — SIMULATED, NOTHING OPENED";
});

/* live region */
const liveEl = $("#live");
function announce(msg){ liveEl.textContent = msg; }

/* shared per-screen furniture */
function furniture(grainOpacity){
  return [
    h("div", { class:"grain", style:grainOpacity != null ? `opacity:${grainOpacity}` : null }),
    h("div", { class:"flash" })
  ];
}
const fireFlash = root => replay(root.querySelector(".flash"), "fire");
const fireShake = el => replay(el, "fire");

/* =====================================================================
   5b · THE SHARED PICKUP BANNER MOCK
   ---------------------------------------------------------------------
   THE FAITHFULNESS DIRECTIVE (owner, 2026-08-08): the lab converges on the
   REAL Fleet tab's anatomy.  In the shipped gacha theme the pickup banner
   (`GachaBanner.tsx`) always rides ABOVE the fleet body — the alt layouts
   replace only the CAPSULE TRACK beneath it.  So every screen here carries
   a banner slot, and this is the one component that fills it.

   It is a MOCK, not a port.  What it copies from the real component is the
   READ — proportion, furniture, cadence — measured off `gacha.css`:
     · height 232px at a 390px column (`.gc-banner{height:232px}`) => the
       aspect is kept as `--u * .595`, clamped so a 430px column does not
       grow a taller banner than production's fixed 232.
     · a flex strip of full-width slides moved by `translateX(-i*100%)`
       with the production snap (620ms == carousel.ts SNAP_MS) and the
       production cadence (5200ms == AUTOPLAY_MS).
     · the copy block at left/bottom: a pill TAG, a 27px display line
       (`--u * .069`), a caption.
     · the RATE + PITY pills cut off by the right edge, in the app's own
       copy grammar (`fleet.ts` rateText/pityText: `★N RATE x.x%` and
       `天井 n`) with mock numbers derived from the mock roster.
     · the dot rail bottom-right, 20x7 boxes morphed by scaleX (never the
       animated `width` §14.11 forbids).

   What it deliberately does NOT copy: the pointer machine.  There is no
   drag, no tap-to-open, no dots-as-buttons — the lab contract is ONE real
   <button> per machine, and a mock that added four more would corrupt the
   very thing the three screens are being compared on.  It is therefore
   `aria-hidden` and inert: a picture of the real component's read.

   Per-screen skinning rides the same custom-property pattern the shared
   dossier already uses (`--dsr-accent` / `data-skin`): the screens set
   `--bn-*` and `data-size`, the component itself is one stylesheet block.
   ------------------------------------------------------------------ */
/* THE GLOBAL BANNER SWITCH — ON / MIN / OFF (owner rulings, WALK 3: "some
   designs will look better without the banner", then the tri-state).
   Session-local, default ON, ONE value for ALL THREE screens — because the
   production shape is one gacha ThemeDef setting choosing GachaBanner's
   form for the whole theme (the `starMode` pattern, which is likewise a
   small enum), not a per-layout option.

   It lives on the STAGE, not on a screen: screens are built lazily and the
   reset rebuilds them all, so a stage-level attribute means a screen built
   later inherits the current value for free.  Per screen the re-flow is one
   small block in styles.css, and MIN needs no new component at all — it
   simply puts every banner into the STRIP form B's strapline already uses,
   so "minimal" is one authored variant rather than a third one. */
const BANNER_MODES = ["on", "min", "off"];
let bannerMode = "on";
/* the component's own form; `data-base` remembers what the screen asked for
   so MIN can borrow the strip and ON can hand it back */
const bannerSizeFor = base => bannerMode === "min" ? "strip" : base;
function applyBanner(){
  stageEl.dataset.banner = bannerMode;
  for (const el of stageEl.querySelectorAll(".bn"))
    el.dataset.size = bannerSizeFor(el.dataset.base);
}

const BANNER_MOCK = [
  /* slide 1 — the fixed hero, the real banner's frozen NETWORK PRIZE POOL */
  { key:"hero", tag:"PICKUP 開催中", lines:["NETWORK","PRIZE POOL"],
    caption:"残り 3日", art:`${ART}/pegasus.webp`, focus:"52% 30%" },
  /* slides 2-3 — one promo per machine, ONLINE and SLEEPING both (the real
     banner's membership is every host, which is what puts a sleeping
     machine's grey promo on the strip) */
  { key:"promo/pegasus", unit:"pegasus" },
  { key:"promo/rook",    unit:"rook" }
];

function buildBanner(screenRoot, cid, opts = {}){
  const { size = "full" } = opts;
  const track = h("div", { class:"bn-track" });
  const dots  = h("div", { class:"bn-dots" });
  const slides = BANNER_MOCK.map((def, i) => {
    const img = h("img", { alt:"", decoding:"async" });
    const tag = h("span", { class:"tag" });
    const ttl = h("b");
    const cap = h("small");
    const el = h("div", { class:"bn-slide" + (def.unit ? " promo" : "") },
      img, h("span", { class:"bn-copy" }, tag, ttl, cap));
    track.append(el);
    dots.append(h("i", { class:i === 0 ? "on" : null }));
    return { def, el, img, tag, ttl, cap };
  });

  /* the two pills, in the app's grammar — `★N RATE x.x%` + `天井 n`.  The
     numbers are mock but LIVE: production feeds rateText() the online host
     count and pityText() the fleet-wide online SERVICE count, so waking a
     machine moves both, and it moves both here too. */
  const rate = h("div", { class:"bn-rate" }, h("span"), h("span"));
  const root = h("div", {
    class:"bn", "data-base":size, "data-size":bannerSizeFor(size), "aria-hidden":"true"
  }, track, h("i", { class:"bn-glow" }), rate, dots);

  function paint(){
    const us = unitsFor(cid);
    const online = us.filter(u => u.status === "ONLINE").length;
    const svc = us.reduce((n, u) => n + (u.status === "ONLINE" ? u.services.length : 0), 0);
    rate.children[0].textContent = `★${STAR_MAX} RATE ${(online * 2.5).toFixed(1)}%`;
    rate.children[1].textContent = `天井 ${svc}`;
    for (const s of slides){
      const d = s.def;
      if (!d.unit){
        s.img.src = d.art;
        s.img.style.setProperty("--focus", d.focus);
        s.tag.textContent = d.tag;
        s.ttl.replaceChildren(d.lines[0], h("br"), d.lines[1]);
        s.cap.textContent = d.caption;
        continue;
      }
      const u = us.find(x => x.id === d.unit);
      const on = u.status === "ONLINE";
      s.el.classList.toggle("sleep", !on);
      s.img.src = u.art;
      /* production crops a CHARACTER slide at face height (`.gc-slide.promo
         img { object-position: 50% 12% }`) — the wide crop, not the card's */
      s.img.style.setProperty("--focus", "50% 12%");
      s.tag.textContent = on ? "確率アップ" : "限定イベント";
      s.ttl.textContent = u.name.toUpperCase();
      s.cap.textContent = `${on ? "稼働中" : "休眠中"} · ${u.role}`;
    }
  }

  let at = 0;
  function go(n){
    at = ((n % slides.length) + slides.length) % slides.length;
    track.style.transform = `translateX(${at * -100}%)`;
    [...dots.children].forEach((d, k) => d.classList.toggle("on", k === at));
  }
  paint(); go(0);

  /* ONE self-rescheduling timer per screen.  It advances only while this
     screen is the active one, the document is visible, motion is not
     reduced and the banner is not switched off — production's `paused`
     gate (`!active || !docVisible || motion === "reduced"`), minus the
     parts that need a pointer, plus the WALK 3 switch.  A detached root
     (the reset rebuilds every screen) stops it for good. */
  const tick = () => {
    if (!root.isConnected) return;
    if (bannerMode !== "off" && !reduced() && !document.hidden && screenRoot.classList.contains("is-active")) go(at + 1);
    setTimeout(tick, 5200);
  };
  setTimeout(tick, 5200);

  root.refresh = paint;
  return root;
}

/* =====================================================================
   6 · CONCEPT BUILDERS
   ===================================================================== */

/* ---------------------------------------------------------------------
   A · THE POSTER
   Composition base: lab v2 concept 02 SLICE STACK (the True Damage
   premium poster — black field, one parallelogram of four equal sheared
   slices, giant vertical wordmark, registry fine print).
   Infused with lab v1 option 1 SIGNAL BANDS' colour grammar, now
   RARITY-DERIVED: a HARD OFFSET DROP under each slice in the star hue
   (the theme's `5px 5px 0` motif) plus a 1px keyline, the machine name in
   that hue at the slice's BOTTOM-LEADING edge (never the top — the ruled
   v2-01 defect) ROTATED TO THE SHEAR with its stars and role line, and a
   status chip at the trailing edge with optional JP glyph tags.
   The PLATE / BLADE chip walks lab v1 option 2's oversized name-blade
   against the compact plate, live, on the same composition.

   ROUND 3 — THE FAITHFULNESS DIRECTIVE.  A now wears the real Fleet tab's
   chrome and its selection model:
     · the PICKUP BANNER slot sits under the `Fleet` line, so the poster is
       judged under the chrome it will actually ship beneath.  The slice
       stack scrolls under it; the stack keeps its off-centre-right seat.
     · the left rail is no longer the static CTRL/B wordmark — it is the
       SELECTED machine's name, vertical, over open background.
     · the footer is no longer the static SERIES 2026 registry — it is the
       SELECTED machine's data (hostname / role / status / ping / uptime /
       last seen / services), in the same registry fine print.  No buttons.
     · SELECT-THEN-OPEN: the first tap selects (rail + footer swap, the
       `.picked` nudge is the affordance); the second tap on the SAME slice
       opens the dossier, or runs the wake ceremony if it is asleep.
       Pegasus is selected at boot.  Still exactly one button per machine.
   ------------------------------------------------------------------ */
let nameMode = "plate";                 /* session-local, A-only, default PLATE */

function buildPoster(cid){
  let us = unitsFor(cid);
  let selected = 0;                     /* Pegasus opens the poster */
  const root = h("section", { class:"screen c-poster", "data-concept":cid, "data-name":nameMode });
  const poster = h("div", { class:"po-poster" });
  const rows = [];

  us.forEach((u, i) => {
    const chip = h("span", { class:"po-chip" }, u.status);
    const btn = h("button", {
      type:"button", class:"po-slice ring",
      style:`--rar:${hueOf(u)}; --focus:${u.focus}`,
      "aria-label":labelPoster(u, i === 0), onclick:() => tap(i)
    },
      /* THE HARD OFFSET DROP — the shipped theme's `5px 5px 0 <hue>`
         motif (--gc-ind-shadow / --gc-bubble-user-shadow), and v1-1
         SIGNAL BANDS' `.band-drop`.  It has to be a DUPLICATED POLYGON:
         a clip-path erases a real box-shadow (the capsule card hit this —
         gacha.css "THE SLOT, and the ARCADE DROP"). */
      h("span", { class:"po-drop", "aria-hidden":"true" }),
      /* the PLATE's background is the rarity keyline; the art sits 1px
         inside the SAME polygon (R18) — an inset box-shadow would be laid
         on the border-box rect and clipped away by the shear. */
      h("span", { class:"po-plate" },
        h("span", { class:"po-art" },
          h("img", { src:u.art, alt:"", decoding:"async" }),
          h("span", { class:"po-glow" }),
          h("span", { class:"po-veil" })),
        h("span", { class:"po-jp", "aria-hidden":"true" }, u.jp),
        /* three siblings so BLADE can re-order the role above the blade
           (a role line under a blade gets sliced by the shear); the whole
           zone is rotated to the shear angle in CSS */
        h("span", { class:"po-zone" },
          starRow(u.stars, "po-stars"),
          h("span", { class:"po-name" }, h("b", null, u.name.toUpperCase())),
          h("span", { class:"po-role" }, u.role)),
        chip,
        h("span", { class:"po-flashline" }))
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    rows.push({ btn, chip });
    poster.append(btn);
  });

  /* --- the SELECTED machine's readout ------------------------------
     ROUND 5: there is only ONE of them now.  The left rail is gone (owner:
     it "makes the PC cards a little bit too small"), so the footer carries
     the whole identity — which is why the hostname left the fine print and
     became a display line. */
  const foot = h("div", { class:"po-data" });

  function footRows(u){
    return [
      /* the headline: the machine's own name, in its rarity hue */
      h("b", { class:"po-fname" }, u.host),
      h("div", null, `${u.role} · ${u.status} · PING ${u.ping}`.toUpperCase()),
      h("div", null, `UPTIME ${u.uptime} · SEEN ${u.seen}`.toUpperCase()),
      h("div", { class:"po-fsvc" }, `SERVICES · ${u.services.join(" · ")}`.toUpperCase())
    ];
  }

  function select(i, { announceIt = true } = {}){
    selected = i;
    rows.forEach((r, k) => {
      r.btn.classList.toggle("picked", k === i);
      r.btn.setAttribute("aria-label", labelPoster(us[k], k === i));
    });
    const u = us[i];
    foot.style.setProperty("--rar", hueOf(u));
    foot.replaceChildren(...footRows(u));
    replay(foot, "swap");
    /* NO auto-scroll on selection (owner ruling, round 5).  The grow +
       nudge IS the feedback; the registry block below is there when the
       owner scrolls to it.  Nothing moves under the finger either — the
       selection affordance is a transform, so the stack does not reflow
       and the slice you tapped stays exactly where you tapped it. */
    if (announceIt) announce(`${u.name} selected. ${u.role}, ${u.stars} stars, ${u.status}.`);
  }

  function tap(i){
    /* step one: SELECT.  step two (same slice): open, or wake. */
    if (i !== selected){ select(i); return; }
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:hueOf(u), skin:"hard" }); return; }
    const { btn, chip } = rows[i];
    runCeremony(root, [
      [0,   () => { poster.classList.add("parting"); announce(`Waking ${u.name}.`); }],
      [180, () => { btn.classList.add("waking"); }],
      [520, () => { btn.classList.remove("asleep"); chip.textContent = "ONLINE"; }],
      [700, () => { poster.classList.remove("parting"); }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      poster.classList.remove("parting");
      btn.classList.remove("asleep", "waking");
      chip.textContent = "ONLINE";
      /* the woken machine is still the selected one — the rail keeps its
         name and the footer has to show the NEW numbers */
      select(i, { announceIt:false });
      banner.refresh();
      announce(`${u.name} is online.`);
    });
  }

  const toggle = h("button", {
    type:"button", class:"po-toggle", "aria-pressed": nameMode === "blade" ? "true" : "false",
    onclick:() => {
      nameMode = nameMode === "plate" ? "blade" : "plate";
      root.dataset.name = nameMode;
      toggle.setAttribute("aria-pressed", nameMode === "blade" ? "true" : "false");
      toggle.replaceChildren(...toggleFace());
      announce(`Name treatment: ${nameMode}.`);
    }
  }, ...toggleFace());
  function toggleFace(){
    return nameMode === "plate"
      ? [h("b", null, "PLATE"), h("span", null, "⇄"), h("i", null, "BLADE")]
      : [h("i", null, "PLATE"), h("span", null, "⇄"), h("b", null, "BLADE")];
  }

  const banner = buildBanner(root, cid);

  root.append(
    h("div", { class:"po-top" },
      h("div", { class:"po-kicker" }, "Fleet"),
      toggle),
    /* ROUND 4 — the banner is the FIRST CHILD OF THE SCROLLING BODY, which
       is exactly what production does: `GachaFleet.tsx` renders
       <GachaBanner/> then the capsule track inside the tab's own scroller
       (`#app-scroll`), and nothing in there is sticky.  So it scrolls away
       and the four-slice poster reads whole.  Only the header above and
       the selected machine's data footer below are pinned. */
    h("div", { class:"po-scroll" },
      h("div", { class:"po-bannerslot" }, banner),
      /* the poster AND its registry scroll together; nothing below the
         header is pinned (round 5) — production's bottom zone belongs to
         the tab switcher and the composer */
      h("div", { class:"po-body" },
        poster,
        h("div", { class:"po-foot" }, foot))),
    ...furniture(.04)
  );
  select(0, { announceIt:false });
  return root;
}

/* ---------------------------------------------------------------------
   B · THE COVER
   Lab v1 option 7 COVER STORY, taken full-screen: masthead + issue line,
   ONE hero machine filling the frame, a left-edge stack of cut-out
   supporting cards, barcode + price gag + fine print.
   Tapping a cut-in PROMOTES it (a short swap ceremony); tapping the hero
   opens the dossier, or — if it is asleep — DEVELOPS the cover: the mono
   plate floods with its rarity hue and a stamp lands.
   ------------------------------------------------------------------ */
/* THE COVER'S OWN HERO CROP (owner ruling, round 5).  Raising the cut-in
   column under the masthead put paper over the leading edge of the frame,
   so the hero art's focal point shifts RIGHT — a LOWER object-position X
   shows more of the image's left, which slides the subject rightwards, out
   from under the stack.  Only the HERO slot is re-cropped; a cut-in is
   112px tall and keeps the roster crop.  Same pattern as C's per-panel
   `focus` overrides: the slot owns the crop, the roster keeps the default. */
const COVER_HERO_FOCUS = {
  pegasus:"30% 26%", atlas:"34% 26%", rook:"34% 22%", lyra:"36% 8%"
};

function buildCover(cid){
  let us = unitsFor(cid);
  let hero = 0;                                   /* Pegasus opens the issue */
  const root = h("section", { class:"screen c-cover", "data-concept":cid });
  const shake = h("div", { class:"shake cv-shake" });
  const page = h("div", { class:"cv-page" });
  const heroSlot = h("div", { class:"cv-heroslot" });
  const stack = h("div", { class:"cv-stack" });
  const cards = [];

  const banner = buildBanner(root, cid, { size:"strip" });
  const issue = h("p", { class:"cv-issue" }, "");
  const mast = h("div", { class:"cv-mast", "aria-hidden":"true" },
    h("span", null, "CTRL/B"),
    h("b", { html:"FLEET<br>STORY" }),
    issue);

  us.forEach((u, i) => {
    const chip  = h("span", { class:"cv-chip" }, u.status);
    const cchip = h("span", { class:"cv-cchip" }, u.status);
    const btn = h("button", {
      type:"button", class:"cv-card ring",
      style:`--rar:${hueOf(u)}; --focus:${u.focus}; --hero-focus:${COVER_HERO_FOCUS[u.id] || u.focus}`,
      onclick:() => tap(i)
    },
      h("span", { class:"cv-shot" }, h("img", { src:u.art, alt:"", decoding:"async" })),
      h("span", { class:"cv-scrim" }),
      h("span", { class:"cv-dev" }),
      h("span", { class:"cv-herocopy" },
        h("small", null, "FEATURED UNIT · 特集"),
        h("b", null, u.name.toUpperCase()),
        h("i", null, `${u.jp} · ${u.role}`),
        h("span", { class:"cv-line" }, starRow(u.stars, "cv-stars"), chip)),
      h("span", { class:"cv-cutcopy" },
        h("b", null, u.name.toUpperCase()),
        cchip),
      h("span", { class:"cv-stamp" }, "AWAKE")
    );
    cards.push({ btn, chip, cchip });
  });

  function place(){
    const hadFocus = cards.find(c => c.btn === document.activeElement);
    us.forEach((u, i) => {
      const c = cards[i];
      c.btn.classList.toggle("is-hero", i === hero);
      c.btn.classList.toggle("is-cut",  i !== hero);
      c.btn.classList.toggle("asleep",  u.status !== "ONLINE");
      c.chip.textContent = u.status;
      c.cchip.textContent = u.status;
      c.btn.setAttribute("aria-label", labelCover(u, i === hero));
    });
    heroSlot.replaceChildren(cards[hero].btn);
    stack.replaceChildren(...cards.filter((_, i) => i !== hero).map(c => c.btn));
    root.style.setProperty("--cover-rar", hueOf(us[hero]));
    issue.textContent = `ISSUE 0${hero + 1} · ${us[hero].status}`;
    /* moving a node in the DOM can drop focus — put it back where it was */
    if (hadFocus) hadFocus.btn.focus({ preventScroll:true });
  }

  function promote(i){
    const u = us[i];
    runCeremony(root, [
      [0,   () => { page.classList.add("turning"); announce(`${u.name} takes the cover.`); }],
      [170, () => { hero = i; place(); }],
      [300, () => { page.classList.remove("turning"); replay(heroSlot, "enter"); }],
      [520, () => { replay(mast, "beat"); }],
      [860, () => { heroSlot.classList.remove("enter"); }]
    ], 880).then(ok => {
      if (!ok) return;
      hero = i; place();
      page.classList.remove("turning");
      heroSlot.classList.remove("enter");
      announce(`${us[i].name} is on the cover. ${us[i].role}, ${us[i].stars} stars, ${us[i].status}.`);
    });
  }

  function develop(){
    const u = us[hero], c = cards[hero];
    runCeremony(root, [
      [0,   () => { root.classList.add("developing"); announce(`Developing the cover. Waking ${u.name}.`); }],
      [150, () => { fireFlash(root); fireShake(shake); }],
      [430, () => { c.btn.classList.remove("asleep"); c.chip.textContent = "ONLINE"; }],
      [600, () => { replay(c.btn, "stamped"); }],
      [880, () => { root.classList.remove("developing"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      root.classList.remove("developing");
      place();
      c.btn.classList.add("stamped");
      banner.refresh();
      announce(`${u.name} is online.`);
    });
  }

  function tap(i){
    if (i !== hero){ promote(i); return; }
    const u = us[hero];
    if (u.status === "ONLINE"){ openDossier(u, { accent:hueOf(u), skin:"soft" }); return; }
    develop();
  }

  page.append(
    heroSlot,
    /* (the rarity spine stripe across the top was CUT by the owner in
       round 5 — nothing replaces it) */
    mast,
    /* the cut-in column: the stack SCROLLS on its own for fleets past N=4,
       the hint sits under it and never moves */
    h("div", { class:"cv-side" },
      stack,
      h("p", { class:"cv-hint", "aria-hidden":"true", html:"CHANGE COVER<br>TAP A CUT-IN" })),
    /* THE STRAPLINE SLOT (faithfulness directive): the pickup banner as a
       cover strapline — BELOW the hero name block, ABOVE the barcode
       footer.  A strip, not a hero: a cover already has one.  The owner's
       alternative slot ("below the cut-in stack") is a walk question. */
    h("div", { class:"cv-strap" }, banner),
    h("div", { class:"cv-foot", "aria-hidden":"true" },
      h("span", { class:"cv-barcode barcode" }),
      h("div", { class:"cv-fine", html:
        `CTRL/B FLEET STORY · SERIES 2026<br>PRINTED ON THE TAILNET · NOT FOR RESALE` }),
      h("span", { class:"cv-price" }, "¥0"))
  );
  shake.append(page);
  root.append(shake, ...furniture(.05));
  place();
  return root;
}

/* ---------------------------------------------------------------------
   C · THE CLUB PAGE
   Lab v2 concept 09 MANGA COLLAGE, refined: hand-authored torn panel
   polygons (the polygon IS the hit area — the clipped-off triangle falls
   through to the panel beneath, R18), screentone fields, yellow-tape name
   plates, sticker chips, the ZZZ + STANDBY panel, and the CTRL/B CLUB
   masthead footer.  Panel rects + focus points retuned so every face sits
   inside its own panel; the rarity hue enters only as a tape cap and an
   inner keyline — the ink-black / paper language still leads.

   ROUND 3 (owner rulings, walk 2 + the faithfulness directive):
     · the PICKUP BANNER takes the top of the screen; `.cl-page` — the
       coordinate space every panel, tape and sticker is authored in —
       starts beneath it, so all three geometries are authored against the
       SHORTER page rather than nudged into it.
     · the tape STARS are stepped up to the production star read.
     · the screentone is THINNED, and pulled back hardest over faces.
     · a GEOMETRY TOGGLE: TILT / CUT / SPREAD.
   ------------------------------------------------------------------ */

/* the per-panel paper field (the colour behind a transparent crop) is a
   property of the SLOT, not of a geometry — it stays put across all three */
const FIELD = ["#ffd23f", "#3fe0e8", "#ff4f9a", "#7b6bff"];

/* --- THE THREE AUTHORED GEOMETRIES -----------------------------------
   `l/t/w/h` are percentages of `.cl-page` · `poly` is the clip path, which
   is ALSO the hit area · `focus` is the per-panel crop (a face-safe zone
   tuned to that panel's aspect) · `z` is the collage order · `tx/ty/trot`
   anchor that panel's yellow tape in PAGE space so it can cross gutters ·
   `units` / `net` / `state` place the three stickers (the state sticker
   belongs to ROOK's panel and follows it).
   ------------------------------------------------------------------ */
const GEO = {
  /* TILT — the walked layout: hand-torn tilted rectangles.  UNCHANGED in
     spirit; only re-fitted to the page under the banner. */
  tilt:{
    panel:[
      { l:1,  t:1,  w:56, h:37, rot:-2, z:6,
        poly:"polygon(3% 1%, 46% 0, 97% 4%, 100% 47%, 98% 89%, 91% 100%, 44% 97%, 5% 95%, 0 48%)",
        focus:"52% 23%", tx:"2%",  ty:"31%", trot:-3 },
      { l:51, t:0,  w:48, h:32, rot:1.6, z:5,
        poly:"polygon(1% 5%, 52% 0, 96% 3%, 100% 44%, 99% 91%, 55% 100%, 8% 99%, 0 52%)",
        focus:"50% 21%", tx:"40%", ty:"23%", trot:2 },
      { l:44, t:29, w:55, h:50, rot:-1.2, z:4,
        poly:"polygon(2% 3%, 55% 0, 100% 2%, 97% 45%, 96% 93%, 50% 100%, 6% 98%, 0 51%)",
        focus:"50% 19%", tx:"42%", ty:"68%", trot:-2 },
      { l:0,  t:38, w:47, h:50, rot:2, z:3,
        poly:"polygon(5% 0, 52% 3%, 100% 5%, 96% 50%, 94% 100%, 48% 98%, 3% 92%, 0 41%)",
        focus:"50% 6%",  tx:"1%",  ty:"79%", trot:3 }
    ],
    units:["3%", "90%"], net:["70%", "92%"], state:["70%", "31%"]
  },

  /* CUT — the knife-edge page: no torn vertices, no rotation, straight
     polygons whose long edges run roughly parallel, so the paper keylines
     read as slashing action-page gutters.  The overlap survives: the
     bands still ride one over another, they just meet on clean lines. */
  cut:{
    panel:[
      { l:0,  t:0,  w:67, h:44, rot:0, z:6,
        poly:"polygon(0 0, 100% 0, 82% 100%, 0 100%)",
        focus:"48% 22%", tx:"2%",  ty:"36%", trot:0 },
      { l:56, t:0,  w:44, h:35, rot:0, z:5,
        poly:"polygon(26% 0, 100% 0, 100% 100%, 0 100%)",
        focus:"56% 20%", tx:"37%", ty:"28%", trot:0 },
      { l:38, t:34, w:62, h:62, rot:0, z:4,
        poly:"polygon(22% 0, 100% 0, 100% 100%, 0 100%)",
        focus:"52% 18%", tx:"41%", ty:"70%", trot:0 },
      { l:0,  t:42, w:53, h:54, rot:0, z:3,
        poly:"polygon(0 0, 100% 0, 78% 100%, 0 100%)",
        focus:"46% 8%",  tx:"1%",  ty:"80%", trot:0 }
    ],
    units:["3%", "93%"], net:["70%", "91%"], state:["66%", "36%"]
  },

  /* SPREAD — the splash page: ONE dominant featured panel (Pegasus) with
     the other three collaged smaller OVER it.  The hero therefore takes
     the BOTTOM of the z-order — the only geometry where `z` is not simply
     the roster order, which is exactly why `z` is authored per geometry
     rather than derived from the index. */
  spread:{
    panel:[
      { l:1,  t:1,  w:97, h:82, rot:-1, z:2,
        poly:"polygon(2% 1%, 48% 0, 98% 3%, 100% 46%, 99% 92%, 52% 100%, 4% 98%, 0 50%)",
        focus:"52% 20%", tx:"2%",  ty:"44%", trot:-3 },
      { l:53, t:52, w:45, h:31, rot:3, z:5,
        poly:"polygon(2% 4%, 54% 0, 97% 4%, 100% 50%, 98% 96%, 50% 100%, 5% 97%, 0 48%)",
        focus:"52% 20%", tx:"41%", ty:"76%", trot:2 },
      { l:2,  t:55, w:45, h:34, rot:-2.5, z:4,
        poly:"polygon(4% 0, 50% 3%, 98% 2%, 100% 48%, 96% 97%, 48% 100%, 3% 96%, 0 46%)",
        focus:"50% 17%", tx:"1%",  ty:"85%", trot:3 },
      { l:60, t:3,  w:38, h:27, rot:2, z:3,
        poly:"polygon(3% 3%, 52% 0, 98% 4%, 100% 50%, 97% 96%, 46% 100%, 4% 97%, 0 47%)",
        focus:"50% 8%",  tx:"36%", ty:"27%", trot:-2 }
    ],
    units:["4%", "2%"], net:["66%", "91%"], state:["4%", "56%"]
  }
};
const GEO_ORDER = ["tilt", "cut", "spread"];
let geoMode = "tilt";                   /* session-local, C-only, default TILT */

function buildClub(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-club", "data-concept":cid, "data-geo":geoMode });
  const shake = h("div", { class:"shake cl-shake" });
  const page = h("div", { class:"cl-page" });
  const banner = buildBanner(root, cid);
  const panels = [];

  us.forEach((u, i) => {
    const zzz = h("span", { class:"cl-zzz", "aria-hidden":"true" },
      h("span", null, "z"), h("span", null, "z"), h("span", null, "Z"));
    const btn = h("button", {
      type:"button", class:"cl-panel ring",
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      /* paper keyline (the button's own bg) > rarity keyline > art:
         three nested layers on the SAME polygon */
      h("span", { class:"cl-keyline" }),
      h("span", { class:"cl-clip" }, h("img", { src:u.art, alt:"", decoding:"async" })),
      h("span", { class:"cl-tone tone-ramp" }),
      h("span", { class:"cl-speed" }),
      u.status !== "ONLINE" ? zzz : null,
      h("span", { class:"cl-bang" }, "WAKE!!")
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");

    /* the tape plate lives in PAGE space so it can cross panel gutters */
    const tape = h("span", {
      class:"cl-tape" + (u.status !== "ONLINE" ? " dim" : ""), "aria-hidden":"true"
    },
      h("i", { class:"cl-cap" }),
      h("span", { class:"cl-tape-txt" },
        h("b", null, u.name.toUpperCase()),
        h("em", null, `${u.jp} · ${u.role}`)),
      h("span", { class:"cl-pill" }, starRow(u.stars))
    );
    panels.push({ btn, zzz, tape });
    page.append(btn, tape);
  });

  /* this sticker sits on the sleeping panel — it must tell that panel's
     TRUTH (decoration never contradicts real status, R23 §A8).  It is
     anchored to ROOK's panel, so it MOVES with the geometry. */
  const stateSticker = h("span",
    { class:"cl-sticker cyan", style:"--srot:4; z-index:14" },
    us[2].status === "ONLINE" ? "ONLINE!" : "STANDBY");
  const unitSticker = h("span", { class:"cl-sticker", style:"--srot:-9; z-index:14" }, "04 UNITS");
  const netSticker  = h("span", { class:"cl-sticker pink", style:"--srot:7; z-index:14" }, "TAILNET");
  page.append(unitSticker, netSticker, stateSticker);

  /* --- THE GEOMETRY TOGGLE (owner ruling, walk 2) -------------------
     Three AUTHORED panel geometries on one DOM.  Switching writes the
     rects, the polygons, the focus points, the z-order and the page-space
     anchors of the tapes + the state sticker — nothing is rebuilt, so the
     wake state, the focus ring and the button identities all survive.
     All three keep what the ruling protected: the collaged one-over-another
     OVERLAP, the yellow tapes, a face-safe crop per panel, and the polygon
     AS the hit area (the clipped-off corner falls through, R18). */
  function applyGeo(name){
    const G = GEO[name];
    us.forEach((u, i) => {
      const p = G.panel[i], { btn, tape } = panels[i];
      btn.style.cssText =
        `left:${p.l}%; top:${p.t}%; width:${p.w}%; height:${p.h}%;` +
        `--rot:${p.rot}; --poly:${p.poly}; --field:${FIELD[i]};` +
        `--focus:${p.focus}; --rar:${hueOf(u)}; z-index:${p.z}`;
      tape.style.cssText =
        `left:${p.tx}; top:${p.ty}; --trot:${p.trot}; --rar:${hueOf(u)}; z-index:${p.z + 10}`;
    });
    unitSticker.style.cssText  = `left:${G.units[0]}; top:${G.units[1]}; --srot:-9; z-index:14`;
    netSticker.style.cssText   = `left:${G.net[0]}; top:${G.net[1]}; --srot:7; z-index:14`;
    stateSticker.style.cssText = `left:${G.state[0]}; top:${G.state[1]}; --srot:4; z-index:14`;
    root.dataset.geo = name;
  }

  const geoChip = h("button", {
    type:"button", class:"cl-geo",
    onclick:() => {
      geoMode = GEO_ORDER[(GEO_ORDER.indexOf(geoMode) + 1) % GEO_ORDER.length];
      applyGeo(geoMode);
      geoChip.replaceChildren(...geoFace());
      geoChip.setAttribute("aria-label", `Panel geometry: ${geoMode}. Tap to cycle.`);
      announce(`Panel geometry: ${geoMode}.`);
    }
  });
  function geoFace(){
    return [h("i", null, "GEO"), h("b", null, geoMode.toUpperCase())];
  }
  geoChip.replaceChildren(...geoFace());
  geoChip.setAttribute("aria-label", `Panel geometry: ${geoMode}. Tap to cycle.`);

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:hueOf(u), skin:"hard" }); return; }
    const { btn, zzz, tape } = panels[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); announce(`Waking ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); }],
      [420, () => { btn.classList.remove("asleep"); tape.classList.remove("dim"); zzz.remove(); }],
      [620, () => { if (i === 2) stateSticker.textContent = "ONLINE!"; }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep", "waking"); tape.classList.remove("dim"); zzz.remove();
      btn.setAttribute("aria-label", labelFor(us[i]));
      if (i === 2) stateSticker.textContent = "ONLINE!";
      banner.refresh();
      announce(`${u.name} is online.`);
    });
  }

  applyGeo(geoMode);
  shake.append(
    /* the banner slot sits ABOVE the collage; `.cl-page` starts under it */
    h("div", { class:"cl-bannerslot" }, banner),
    page,
    geoChip,
    h("div", { class:"cl-title" },
      h("h2", { html:"CTRL<em>/</em>B CLUB" }),
      h("p", { html:"SERIES 2026 · FOUR MACHINES · ALL RIGHTS RESERVED<br>REPRODUCTION IN WHOLE OR IN PART IS PROHIBITED" })));
  root.append(shake, ...furniture(.06));
  return root;
}

/* =====================================================================
   7 · SWITCHER + BOOT
   ===================================================================== */
const CONCEPTS = [
  { key:"A", name:"THE POSTER",   build:buildPoster },
  { key:"B", name:"THE COVER",    build:buildCover  },
  { key:"C", name:"THE CLUB PAGE", build:buildClub  }
];

const screensEl = $("#screens");
const swIndex = $("#sw-index");
const swName = $("#sw-name");
let built = new Array(CONCEPTS.length).fill(null);
let current = -1;

function show(i, { announceIt = true } = {}){
  i = ((i % CONCEPTS.length) + CONCEPTS.length) % CONCEPTS.length;
  if (i === current) return;
  const c = CONCEPTS[i];
  if (!built[i]){
    built[i] = c.build(c.key);
    screensEl.append(built[i]);
  }
  built.forEach((el, k) => el && el.classList.toggle("is-active", k === i));
  current = i;
  swIndex.textContent = `${c.key}/3`;
  swName.textContent = `${c.key} · ${c.name}`;
  replay(swName, "show");
  const hash = "#" + c.key;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  if (announceIt) announce(`Concept ${c.key}, ${c.name}. Four machines, one sleeping.`);
}

function resetAll(){
  wake.clear();
  const at = current;
  built = new Array(CONCEPTS.length).fill(null);
  current = -1;
  screensEl.replaceChildren();
  show(at < 0 ? 0 : at, { announceIt:false });
  announce("Every concept reset. Rook is asleep again.");
}

$("#sw-prev").addEventListener("click", () => show(current - 1));
$("#sw-next").addEventListener("click", () => show(current + 1));
$("#sw-reset").addEventListener("click", resetAll);

/* the global banner switch — one chip, three values, all three screens */
const bannerChip = $("#sw-banner");
function paintBannerChip(){
  bannerChip.replaceChildren(h("i", null, "BN"), h("b", null, bannerMode.toUpperCase()));
  bannerChip.setAttribute("aria-label", `Pickup banner: ${bannerMode}. Tap to cycle.`);
  bannerChip.dataset.mode = bannerMode;
}
bannerChip.addEventListener("click", () => {
  bannerMode = BANNER_MODES[(BANNER_MODES.indexOf(bannerMode) + 1) % BANNER_MODES.length];
  applyBanner();
  paintBannerChip();
  announce(`Pickup banner: ${bannerMode}, on every concept.`);
});
paintBannerChip();

document.addEventListener("keydown", e => {
  if (!dsr.layer.hidden) return;
  if (e.key === "ArrowLeft"){ e.preventDefault(); show(current - 1); }
  else if (e.key === "ArrowRight"){ e.preventDefault(); show(current + 1); }
});
window.addEventListener("hashchange", () => {
  const i = CONCEPTS.findIndex(c => c.key === location.hash.replace("#", "").toUpperCase());
  if (i >= 0) show(i);
});

const startKey = location.hash.replace("#", "").toUpperCase();
applyBanner();
show(Math.max(0, CONCEPTS.findIndex(c => c.key === startKey)), { announceIt:false });

})();
