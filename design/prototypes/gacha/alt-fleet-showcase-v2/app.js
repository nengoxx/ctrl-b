/* =====================================================================
   CTRL/B — ALT FLEET LAB v2 · app.js
   Ten immersive concept screens, one mock roster, no framework.

   Modules, in order:
     1  roster data + derivations
     2  tiny DOM helper
     3  wake store (per-concept local state)
     4  ceremony engine (R24 B.3: 5 beats <=900ms, tap-anywhere-skips)
     5  shared dossier
     6  concept builders 01..10
     7  switcher + boot
   ===================================================================== */
(() => {
"use strict";

/* ---------------------------------------------------------------------
   1 · ROSTER — the same four machines in every concept.
   Mirrors alt-fleet-showcase (lab v1) so the two labs agree.
   ------------------------------------------------------------------ */
const ART = "./assets";

const ROSTER = [
  {
    id:"pegasus", name:"Pegasus", jp:"天馬", role:"WORKSTATION",
    epithet:"the Winged Furnace",
    status:"ONLINE", stars:5, ping:"18 ms", seen:"now", uptime:"41d 06h",
    host:"PEGASUS-01", vendor:"CUSTOM / AM5", berth:"BERTH 01", serial:"004-ζ",
    prefix:"Wk.", glyph:"▣", locked:false,
    art:`${ART}/pegasus.webp`, focus:"50% 26%", accent:"#ff4f9a", accentAlt:"#ffd23f",
    services:["Hermes","ComfyUI","Open WebUI","File relay","Speaches"]
  },
  {
    id:"atlas", name:"Atlas", jp:"地図", role:"HOME SERVER",
    epithet:"the Patient Shoulder",
    status:"ONLINE", stars:4, ping:"7 ms", seen:"now", uptime:"128d 19h",
    host:"ATLAS-HOME", vendor:"SUPERMICRO", berth:"BERTH 02", serial:"011-β",
    prefix:"Sv.", glyph:"▤", locked:true,
    art:`${ART}/atlas.webp`, focus:"50% 26%", accent:"#6fd6ff", accentAlt:"#a0f0ff",
    services:["Storage","Backups","Jellyfin","Home bridge"]
  },
  {
    id:"rook", name:"Rook", jp:"塔", role:"MINI NODE",
    epithet:"the Sleeping Tower",
    status:"SLEEPING", stars:2, ping:"—", seen:"2h ago", uptime:"—",
    host:"ROOK-MINI", vendor:"INTEL NUC", berth:"BERTH 03", serial:"027-δ",
    prefix:"Nd.", glyph:"▥", locked:false,
    art:`${ART}/3.webp`, focus:"50% 24%", accent:"#a98bff", accentAlt:"#cfc0ff",
    services:["Wake relay","Build runner"]
  },
  {
    id:"lyra", name:"Lyra", jp:"琴", role:"MEDIA VAULT",
    epithet:"the Silent Chorus",
    status:"ONLINE", stars:3, ping:"12 ms", seen:"now", uptime:"12d 03h",
    host:"LYRA-VLT", vendor:"SYNOLOGY", berth:"BERTH 04", serial:"048-λ",
    prefix:"Vt.", glyph:"▦", locked:false,
    art:`${ART}/4.webp`, focus:"50% 8%", accent:"#ff8a5c", accentAlt:"#ffc09a",
    services:["Media","Archive","Sync"]
  }
];

/* derivations */
const LADDER = ["D","C","B","A","S"];
const GRADE_ROWS = [["CPU",0],["RAM",-1],["GPU",-2],["NET",1]];
const gradeOf = (stars, off) => LADDER[Math.max(0, Math.min(4, stars - 1 + off))];
const gradesFor = u => GRADE_ROWS.map(([k, off]) => [k, gradeOf(u.stars, off)]);
const stars = n => "★".repeat(n) + "☆".repeat(5 - n);
const RARITY = { 5:"#ffcf5a", 4:"#b07dff", 3:"#5fd0ff", 2:"#8b95a5", 1:"#6b7280" };
const rarityOf = u => RARITY[u.stars] || "#6b7280";
/* three coprime bar periods keyed off the hostname — A16 */
function barcodeVars(u){
  let s = 0; for (const c of u.host) s += c.charCodeAt(0);
  return `--b1:${3 + (s % 3)}px; --b2:${5 + (s % 5)}px; --b3:${9 + (s % 7)}px`;
}
const labelFor = u =>
  `${u.name}, ${u.role.toLowerCase()}, ${u.stars} stars, ` +
  (u.status === "ONLINE" ? "online. Opens the unit dossier." : "sleeping. Runs the wake sequence.");

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
   3 · WAKE STORE — per-concept local state, so each screen is walked fresh
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
   Five beats, <=900ms, and tapping anywhere collapses to the final frame.
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
  const { accent = u.accent, skin = "soft" } = opts;
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
  dsr.stars.textContent = stars(u.stars);
  dsr.serial.textContent = `FILE NO. ${u.serial} · ${u.host}`;
  dsr.status.textContent = "SIMULATED — NO REAL HOST";
  dsr.rows.replaceChildren(
    ...[["HOSTNAME", u.host], ["STATUS", u.status], ["UPTIME", u.uptime],
        ["PING", u.ping], ["LAST SEEN", u.seen], ["VENDOR", u.vendor],
        ["SERVICES", u.services.join(" · ")]]
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

/* ---------------------------------------------------------------------
   live region
   ------------------------------------------------------------------ */
const liveEl = $("#live");
function announce(msg){ liveEl.textContent = msg; }

/* shared per-screen furniture */
function furniture(grainOpacity){
  return [
    h("div", { class:"grain", style:grainOpacity != null ? `opacity:${grainOpacity}` : null }),
    h("div", { class:"flash" })
  ];
}
const flashOf = root => root.querySelector(".flash");
function fireFlash(root){ replay(flashOf(root), "fire"); }
function fireShake(el){ replay(el, "fire"); }
/* =====================================================================
   6 · CONCEPT BUILDERS
   Each returns a <section class="screen"> and owns its own fiction,
   palette, idle motion, selection states and wake ceremony.
   ===================================================================== */

/* ---------------------------------------------------------------------
   01 · SIGNAL BANDS — the ZZZ diagonal roster poster
   ------------------------------------------------------------------ */
function buildSignal(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-signal", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:absolute;inset:0;overflow:hidden" });

  const tickerText = () => us.map(u =>
    `◆ ${u.name.toUpperCase()} ${u.status} ${u.uptime !== "—" ? u.uptime : "STANDBY"} · ${u.ping} `).join("");
  const tickIn = h("div", { class:"sb-ticker-in" },
    h("span", null, tickerText()), h("span", null, tickerText()));

  const track = h("div", { class:"sb-track" });
  const names = h("div", { class:"sb-names", "aria-hidden":"true" });
  const bands = [];

  us.forEach((u, i) => {
    const chip = h("span", { class:"sb-chip" }, u.status);
    const img = h("img", { src:u.art, alt:"", decoding:"async" });
    const btn = h("button", {
      type:"button", class:"sb-band ring", style:`--accent:${u.accent};--focus:${u.focus}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      img,
      h("div", { class:"sb-plate" }), h("div", { class:"sb-veil" }), h("div", { class:"sb-edge" }),
      h("div", { class:"sb-zone" },
        h("span", { class:"sb-stars" }, stars(u.stars)),
        h("span", { class:"sb-foot" }, chip, h("span", { class:"sb-role" }, u.role))),
      h("div", { class:"sb-sweep" }),
      h("span", { class:"sb-burst" }, "WAKE!")
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    bands.push({ btn, chip });
    track.append(btn);

    const top = `calc(${i} * (208px - var(--run) + var(--gut)) + 26px)`;
    names.append(
      h("span", { class:"sb-name" + (i % 2 ? " solid" : ""),
        style:`--accent:${u.accent}; top:${top}; left:${10 + i * 16}px` }, u.name.toUpperCase()),
      h("span", { class:"sb-jp", style:`top:calc(${i} * (208px - var(--run) + var(--gut)) + 78px)` }, u.jp)
    );
  });
  track.append(names);

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:u.accent, skin:"hard" }); return; }
    const { btn, chip } = bands[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); announce(`Sending wake packet to ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); }],
      [500, () => { btn.classList.remove("asleep"); chip.textContent = "ONLINE"; }],
      [760, () => { tickIn.replaceChildren(h("span", null, tickerText()), h("span", null, tickerText())); }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep"); btn.setAttribute("aria-label", labelFor(us[i]));
      chip.textContent = "ONLINE";
      tickIn.replaceChildren(h("span", null, tickerText()), h("span", null, tickerText()));
      announce(`${u.name} is online.`);
    });
  }

  shake.append(
    h("header", { class:"sb-head" },
      h("div", { class:"sb-mark", html:"CTRL<em>/</em>B" }),
      h("div", { class:"sb-sub", html:"SIGNAL BANDS<br>04 UNITS · TAILNET" })),
    h("div", { class:"sb-ticker" }, tickIn),
    track
  );
  root.append(shake, ...furniture(.06));
  return root;
}

/* ---------------------------------------------------------------------
   02 · SLICE STACK — the True Damage premium poster (maximal restraint)
   ------------------------------------------------------------------ */
function buildSlice(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-slice", "data-concept":cid });
  const poster = h("div", { class:"sl-poster" });
  const slices = [];

  us.forEach((u, i) => {
    const tag = h("span", { class:"sl-tag" }, `${String(i + 1).padStart(2, "0")} ${u.name.toUpperCase()}`);
    const btn = h("button", {
      type:"button", class:"sl-slice ring", style:`--focus:${u.focus}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"sl-key" }), tag, h("span", { class:"sl-flashline" })
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    slices.push({ btn, tag });
    poster.append(btn);
  });

  function tap(i){
    const u = us[i];
    slices.forEach((s, k) => s.btn.classList.toggle("picked", k === i));
    if (u.status === "ONLINE"){
      openDossier(u, { accent:"#ffffff", skin:"hard" });
      return;
    }
    const { btn, tag } = slices[i];
    runCeremony(root, [
      [0,   () => { poster.classList.add("parting"); announce(`Waking ${u.name}.`); }],
      [200, () => { btn.classList.add("waking"); }],
      [560, () => { btn.classList.remove("asleep"); tag.textContent = `0${i + 1} ${u.name.toUpperCase()}`; }],
      [700, () => { poster.classList.remove("parting"); }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      poster.classList.remove("parting");
      btn.classList.remove("asleep", "waking");
      btn.setAttribute("aria-label", labelFor(us[i]));
      announce(`${u.name} is online.`);
    });
  }

  root.append(
    h("div", { class:"sl-top" }, h("div", { class:"sl-kicker" }, "Fleet")),
    poster,
    h("div", { class:"sl-word", "aria-hidden":"true" }, "CTRL/B"),
    h("div", { class:"sl-foot" },
      h("div", { class:"sl-serials", html:
        `SERIES 2026 · FOUR MACHINES<br>` +
        us.map(u => `${u.host} / ${u.serial}`).join("<br>") +
        `<br>PRINTED ON THE TAILNET` })),
    ...furniture(.04)
  );
  return root;
}

/* ---------------------------------------------------------------------
   03 · CHARACTER SELECT — the fighting-game slab (Strive x SF6)
   ------------------------------------------------------------------ */
function buildSelect(cid){
  let us = unitsFor(cid);
  let sel = 0;
  const root = h("section", { class:"screen c-select", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:absolute;inset:0;overflow:hidden" });

  const plate = h("div", { class:"cs-plate" }, h("div", { class:"grain" }));
  const heroImg = h("img", { src:us[0].art, alt:"", decoding:"async" });
  const hero = h("div", { class:"cs-hero" }, heroImg);
  const nameEl = h("h2", { class:"cs-name" }, us[0].name.toUpperCase());
  const epiEl = h("p", { class:"cs-epithet" }, us[0].epithet);
  const metaEl = h("div", { class:"cs-meta" });
  const ring = h("div", { class:"cs-ring" });
  const rail = h("div", { class:"cs-rail" });
  const tiles = [];

  us.forEach((u, i) => {
    const zzz = h("span", { class:"cs-tile-z" }, "z");
    const btn = h("button", {
      type:"button", class:"cs-tile ring", style:`--tile-accent:${u.accent};--focus:${u.focus}`,
      "aria-label":`${u.name}, ${u.role.toLowerCase()}, ${u.status.toLowerCase()}. ` +
        (u.status === "ONLINE" ? "Select, then open dossier." : "Select and run the wake sequence."),
      onclick:() => tap(i)
    },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"cs-tile-no" }, String(i + 1).padStart(2, "0")),
      u.status !== "ONLINE" ? zzz : null
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    tiles.push({ btn, zzz });
    rail.append(btn);
  });

  function paintMeta(u){
    metaEl.replaceChildren(
      h("span", { class:"cs-stars" }, stars(u.stars)),
      h("span", null, u.host),
      h("span", null, u.status === "ONLINE" ? `PING ${u.ping}` : "STANDBY"),
      h("span", null, u.status === "ONLINE" ? `UP ${u.uptime}` : `SEEN ${u.seen}`)
    );
  }

  function select(i, { slam = true } = {}){
    sel = i;
    const u = us[i];
    root.style.setProperty("--accent", u.accent);
    heroImg.src = u.art;
    heroImg.style.setProperty("--focus", u.focus);
    hero.classList.toggle("asleep", u.status !== "ONLINE");
    nameEl.textContent = u.name.toUpperCase();
    epiEl.textContent = u.epithet;
    paintMeta(u);
    tiles.forEach((t, k) => t.btn.classList.toggle("on", k === i));
    if (slam){
      replay(hero, "enter");        /* portrait arrives first ... */
      replay(nameEl, "slam");       /* ... the name lands 80ms later (CSS delay) */
      replay(ring, "fire");
    }
  }

  function tap(i){
    const u = us[i];
    if (i !== sel){ select(i); }
    if (u.status !== "ONLINE"){ ceremony(i); return; }
    if (i !== sel) return;
    openDossier(u, { accent:u.accent, skin:"soft" });
  }

  function ceremony(i){
    const u = us[i];
    const { btn, zzz } = tiles[i];
    runCeremony(root, [
      [0,   () => { plate.style.opacity = ".55"; hero.style.transform = "scale(.965)";
                    hero.style.transition = "transform 180ms var(--e-anticipate)";
                    announce(`Wake packet sent to ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); replay(ring, "fire");
                    hero.style.transform = ""; hero.style.transition = "transform 220ms var(--e-overshoot)"; }],
      [300, () => { plate.style.opacity = ""; }],
      [500, () => { hero.classList.remove("asleep"); btn.classList.remove("asleep"); zzz.remove();
                    replay(nameEl, "slam"); }],
      [640, () => { wake.set(cid, u.id); us = unitsFor(cid); paintMeta(us[i]); }],
      [880, () => { hero.style.transition = ""; }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      hero.classList.remove("asleep"); btn.classList.remove("asleep");
      btn.setAttribute("aria-label", `${u.name}, ${u.role.toLowerCase()}, online. Select, then open dossier.`);
      paintMeta(us[i]);
      announce(`${u.name} is online.`);
    });
  }

  shake.append(
    plate, hero,
    h("header", { class:"cs-head" },
      h("div", { class:"cs-title", html:"SELECT YOUR MACHINE<small>マシンをえらべ · 04 UNITS</small>" }),
      h("span", { class:"cs-p1" }, "P1")),
    h("div", { class:"cs-plate-copy" }, nameEl, epiEl, metaEl),
    h("div", { class:"cs-cue" },
      h("span", { html:"&#9654; TAP TO SELECT · TAP AGAIN TO OPEN" }),
      h("b", null, "READY?")),
    ring, rail
  );
  root.append(shake, ...furniture(.05));
  select(0, { slam:false });
  return root;
}

/* ---------------------------------------------------------------------
   04 · THE DOCK — berths, rarity frames, and a ceremony that is a
   genuine progress indicator (a real elapsed timer runs)
   ------------------------------------------------------------------ */
function buildDock(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-dock", "data-concept":cid });
  const grid = h("div", { class:"dk-grid" });
  const cells = [];

  us.forEach((u, i) => {
    const up = h("span", { class:"dk-up" }, u.status === "ONLINE" ? `UP ${u.uptime}` : "STANDBY");
    const timer = h("span", { class:"dk-timer" }, "00:00.0");
    const btn = h("button", {
      type:"button", class:"dk-berth ring",
      style:`--rarity:${rarityOf(u)};--focus:${u.focus}`,
      "aria-label":`${u.berth}. ${labelFor(u)}`, onclick:() => tap(i)
    },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("div", { class:"dk-panel" }), h("div", { class:"dk-rivets" }),
      h("span", { class:"dk-no" }, u.berth),
      h("span", { class:"dk-glyph", "aria-hidden":"true" }, u.glyph),
      u.locked ? h("span", { class:"dk-lock", title:"do not wake" }, "⚿") : null,
      h("span", { class:"dk-seam t" }), h("span", { class:"dk-seam b" }),
      h("span", { class:"dk-column" }), timer,
      h("div", { class:"dk-foot" },
        h("span", { class:"dk-name" }, u.name.toUpperCase()),
        h("span", { class:"dk-line" }, up, h("span", { class:"dk-stars" }, stars(u.stars))))
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    cells.push({ btn, up, timer });
    grid.append(btn);
  });

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:rarityOf(u), skin:"hard" }); return; }
    const { btn, up, timer } = cells[i];
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const ms = performance.now() - t0;
      const s = Math.floor(ms / 1000), cs = Math.floor((ms % 1000) / 100);
      timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${cs}`;
      raf = requestAnimationFrame(tick);
    };
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); up.textContent = "BOOTING"; tick();
                    announce(`${u.berth} unsealing. ${u.name} booting.`); }],
      [520, () => { btn.classList.remove("asleep"); }],
      [860, () => { cancelAnimationFrame(raf);
                    const took = ((performance.now() - t0) / 1000).toFixed(1);
                    up.textContent = `BOOT ${took}s`; }],
      [880, () => { btn.classList.remove("waking"); btn.classList.add("sealed"); }]
    ]).then(ok => {
      cancelAnimationFrame(raf);
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep", "waking");
      btn.setAttribute("aria-label", `${u.berth}. ${labelFor(us[i])}`);
      if (!up.textContent.startsWith("BOOT ")) up.textContent = "UP 0d 00h";
      setTimeout(() => btn.classList.remove("sealed"), 240);
      announce(`${u.name} berthed and online.`);
    });
  }

  const online = () => us.filter(u => u.status === "ONLINE").length;
  root.append(
    h("header", { class:"dk-head" },
      h("div", { class:"dk-mark", html:"DOCK<span>/</span>CTRL-B" }),
      h("div", { class:"dk-tot" },
        h("span", { html:`<b>${us.length}</b>BERTHS` }),
        h("span", { html:`<b>${online()}</b>ONLINE` }),
        h("span", { html:"<b>14</b>STARS" }))),
    grid,
    h("div", { class:"dk-bar" }, h("span", null, "SEALED HULLS · TAILNET DRYDOCK"), h("span", null, "REV 2.6")),
    ...furniture(.04)
  );
  return root;
}

/* ---------------------------------------------------------------------
   05 · OPERATOR FILE — the personnel dossier + the print kit
   Tap once: the file opens in place (letter-graded exam block).
   Tap again: the shared dossier, in its print skin.
   ------------------------------------------------------------------ */
function buildFile(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-file", "data-concept":cid });
  const list = h("div", { class:"of-list" });
  const cards = [];

  us.forEach((u, i) => {
    const tab = h("span", { class:"of-tab" }, u.status === "ONLINE" ? "ACTIVE DUTY" : "STANDBY");
    const stamp = h("span", { class:"of-stamp" + (u.status === "ONLINE" ? " online" : "") },
      u.status === "ONLINE" ? "ONLINE" : "STANDBY");
    const more = h("div", { class:"of-more" }, "OPEN FULL DOSSIER ▸");
    const exam = h("div", { class:"of-exam" },
      h("div", { class:"of-exam-h" }, h("span", null, "PHYSICAL EXAM"), h("span", null, `FILE ${u.serial}`)),
      h("div", { class:"of-grades" },
        gradesFor(u).map(([k, g], gi) =>
          h("div", { class:"of-grade", style:`--i:${gi}` }, h("b", null, g), h("span", null, k)))),
      h("div", { class:"of-note" }, h("span", null, "CLINICAL NOTES"), h("i", { class:"of-redact" })),
      more);
    const btn = h("button", {
      type:"button", class:"of-card ring", style:`--accent:${u.accent};--focus:${u.focus}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      h("div", { class:"of-row" },
        h("div", { class:"of-thumb" }, h("img", { src:u.art, alt:"", decoding:"async" })),
        h("div", { class:"of-id" },
          h("div", { class:"of-name", html:`${u.name.toUpperCase()}<em>${u.jp}</em>` }),
          h("div", { class:"of-sub", html:
            `${u.host} · ${u.vendor}<br>ORIGIN ${u.role} · ${stars(u.stars)}` }),
          h("div", { class:"of-barcode barcode", style:barcodeVars(u) }))),
      exam, tab, stamp,
      h("span", { class:"of-dispatch" }, "DISPATCHING…"),
      h("span", { class:"of-scan" }), h("span", { class:"of-wipe" })
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    cards.push({ btn, tab, stamp, exam, more });
    list.append(btn);
  });

  function tap(i){
    const u = us[i];
    const c = cards[i];
    if (u.status !== "ONLINE"){ ceremony(i); return; }
    if (!c.btn.classList.contains("open")){
      cards.forEach((x, k) => x.btn.classList.toggle("open", k === i));
      /* restage the staggered grade reveal */
      c.exam.querySelectorAll(".of-grade").forEach(g => replay(g, "of-grade"));
      announce(`${u.name} file open. Exam ${gradesFor(u).map(([k, g]) => k + " " + g).join(", ")}.`);
      return;
    }
    openDossier(u, { accent:u.accent, skin:"print" });
  }

  function ceremony(i){
    const u = us[i];
    const { btn, tab, stamp } = cards[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); tab.textContent = "DISPATCH"; announce(`Dispatching wake order to ${u.name}.`); }],
      [200, () => { fireFlash(root); }],
      [560, () => { btn.classList.remove("asleep"); }],
      [640, () => { stamp.textContent = "ONLINE"; stamp.classList.add("online"); replay(stamp, "thud"); }],
      [880, () => { btn.classList.remove("waking"); tab.textContent = "ACTIVE DUTY"; }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep", "waking");
      tab.textContent = "ACTIVE DUTY";
      stamp.textContent = "ONLINE"; stamp.classList.add("online");
      btn.setAttribute("aria-label", labelFor(us[i]));
      announce(`${u.name} stamped online.`);
    });
  }

  root.append(
    h("div", { class:"of-sheet" },
      h("div", { class:"of-watermark", "aria-hidden":"true" }, "CTRL/B"),
      h("header", { class:"of-head" },
        h("div", { class:"of-org", html:"PERSONNEL<br>REGISTRY<small>ホームラボ人事課 · SECTION B</small>" }),
        h("div", { class:"of-fileno", html:"FILE SET 004<br>REV 2026.08<br>CLEARANCE ζ" })),
      h("div", { class:"of-hazard" }),
      list,
      h("div", { class:"of-summary" },
        h("div", { html:`<b>${us.filter(u => u.status === "ONLINE").length}/4</b>ON DUTY` }),
        h("div", { html:"<b>14</b>TOTAL STARS" }),
        h("div", { html:"<b>ζ</b>CLEARANCE" }),
        h("div", { html:"<b>B</b>SECTION" })),
      h("div", { class:"of-hazard", style:"margin-top:12px" }),
      h("div", { class:"of-foot" }, h("span", null, "PAGE 1 OF 1"), h("span", null, "NOT FOR DISTRIBUTION"))),
    ...furniture(.07)
  );
  return root;
}
/* ---------------------------------------------------------------------
   06 · FLEET/4 — the group poster (K/DA) with FGO's pre-lit flip
   Every card sits at 0,0 and is placed purely by transform.
   ------------------------------------------------------------------ */
function buildFleet4(cid){
  let us = unitsFor(cid);
  let lead = 0;
  const root = h("section", { class:"screen c-fleet4", "data-concept":cid });
  const pattern = h("div", { class:"f4-pattern", "aria-hidden":"true" },
    ("CTRL/B FLEET ").repeat(28));
  const arc = h("div", { class:"f4-arc" });
  const strip = h("div", { class:"f4-strip" });
  const cards = [];

  us.forEach((u, i) => {
    const front = h("span", { class:"f4-face front" },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"f4-rim" }), h("span", { class:"f4-sil" }),
      h("span", { class:"f4-tag" }, u.name.toUpperCase()));
    const back = h("span", { class:"f4-face back" },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"f4-rim" }),
      h("span", { class:"f4-tag" }, u.name.toUpperCase()));
    const inner = h("span", { class:"f4-inner" }, front, back);
    const btn = h("button", {
      type:"button", class:"f4-card ring", style:`--accent:${u.accent};--focus:${u.focus}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    }, inner);
    if (u.status !== "ONLINE") front.classList.add("silhouette");
    cards.push({ btn, inner, front });
    arc.append(btn);

    const s = h("span", { class:"f4-strip-name", style:`--accent:${u.accent}` }, u.name);
    strip.append(s);
  });

  const SLOTS = [
    { tx:0,    ty:18, rot:-6 }, { tx:24.3, ty:-2, rot:-2 },
    { tx:47.5, ty:-2, rot:2 },  { tx:70.5, ty:18, rot:6 }
  ];
  function place(){
    cards.forEach(({ btn }, i) => {
      const base = SLOTS[i];
      /* z stacks OUTWARD from the lead; back members spread away from the
         lead and lift, so every face stays at least half visible */
      const s = i === lead
        ? { tx:base.tx + (35 - base.tx) * .3, ty:base.ty + 86, rot:0, sc:1.24, z:10 }
        : { tx:base.tx + (i < lead ? -7 : 7), ty:base.ty - 14, rot:base.rot,
            sc:1, z:10 - Math.abs(i - lead) };
      btn.style.setProperty("--tx", s.tx); btn.style.setProperty("--ty", s.ty);
      btn.style.setProperty("--rot", s.rot); btn.style.setProperty("--sc", s.sc);
      btn.style.setProperty("--z", s.z);
      btn.classList.toggle("lead", i === lead);
    });
    [...strip.children].forEach((s, i) => s.classList.toggle("on", i === lead));
    root.style.setProperty("--accent", us[lead].accent);
  }

  function tap(i){
    const u = us[i];
    if (i !== lead){ lead = i; place(); announce(`${u.name} steps forward.`); if (u.status === "ONLINE") return; }
    if (u.status === "ONLINE"){ openDossier(u, { accent:u.accent, skin:"soft" }); return; }
    ceremony(i);
  }

  function ceremony(i){
    const u = us[i];
    const { btn, inner, front } = cards[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("flip"); announce(`${u.name} turning over.`); }],
      [180, () => { fireFlash(root); replay(pattern, "pulse"); }],
      [620, () => { front.classList.remove("silhouette"); }],
      [700, () => {
        inner.style.transition = "none"; btn.classList.remove("flip");
        void inner.offsetWidth; inner.style.transition = "";
      }],
      [880, () => {}]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      front.classList.remove("silhouette");
      inner.style.transition = "none"; btn.classList.remove("flip");
      void inner.offsetWidth; inner.style.transition = "";
      btn.setAttribute("aria-label", labelFor(us[i]));
      announce(`${u.name} lands full colour. Online.`);
    });
  }

  root.append(
    h("div", { class:"f4-field" }), pattern,
    h("h2", { class:"f4-word", html:"CTRL/B<span>FLEET · 04</span>" }),
    arc, strip,
    h("div", { class:"f4-credits" }, "ARTWORK · TAILNET RECORDS · MMXXVI · ALL FOUR MACHINES"),
    ...furniture(.05)
  );
  place();
  return root;
}

/* ---------------------------------------------------------------------
   07 · THE CUT-IN — the Persona two-tone diagonal
   ------------------------------------------------------------------ */
function buildCutIn(cid){
  let us = unitsFor(cid);
  let sel = 0;
  const root = h("section", { class:"screen c-cutin", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:absolute;inset:0;overflow:hidden" });

  const crop = h("div", { class:"ci-crop" }, h("img", { src:us[0].art, alt:"", decoding:"async" }));
  const figure = h("div", { class:"ci-figure" },
    h("span", { class:"ci-keyplate two" }), h("span", { class:"ci-keyplate" }),
    crop, h("span", { class:"ci-silflash" }));
  const bandFill = h("span", { class:"ci-bandfill" });
  const band = h("div", { class:"ci-band" }, bandFill,
    h("span", { class:"ci-bandtext" }, "CUT IN · CUT IN · CUT IN · CUT IN · CUT IN"));
  const nameEl = h("h2", { class:"ci-name" }, us[0].name.toUpperCase());
  const ghosts = [1, 2, 3].map(n => h("h2", { class:"ci-ghost g" + n, "aria-hidden":"true" }, us[0].name.toUpperCase()));
  const epi = h("p", { class:"ci-epi" }, us[0].epithet.toUpperCase());
  const chipRow = h("div", { class:"ci-chips" });
  const chips = [];

  us.forEach((u, i) => {
    const btn = h("button", {
      type:"button", class:"ci-chip ring", style:`--i:${i};--focus:${u.focus}`,
      "aria-label":`${u.name}, ${u.status.toLowerCase()}. ` +
        (u.status === "ONLINE" ? "Cut in, then open dossier." : "Cut in and wake."),
      onclick:() => tap(i)
    },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"ci-chip-no" }, String(i + 1).padStart(2, "0")));
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    chips.push(btn);
    chipRow.append(btn);
  });

  function select(i){
    sel = i;
    const u = us[i];
    crop.firstChild.src = u.art;
    crop.firstChild.style.setProperty("--focus", u.focus);
    figure.classList.toggle("asleep", u.status !== "ONLINE");
    nameEl.textContent = u.name.toUpperCase();
    ghosts.forEach(g => g.textContent = u.name.toUpperCase());
    epi.textContent = u.epithet.toUpperCase();
    chips.forEach((c, k) => c.classList.toggle("on", k === i));
    replay(figure, "replace");
    replay(nameEl, "collapse");
  }

  function tap(i){
    const u = us[i];
    if (i !== sel){ select(i); if (u.status === "ONLINE") return; }
    if (u.status === "ONLINE"){ openDossier(u, { accent:"#22e6ff", skin:"hard" }); return; }
    ceremony(i);
  }

  function ceremony(i){
    const u = us[i];
    runCeremony(root, [
      [0,   () => { replay(band, "sweep"); announce(`Cut-in. Waking ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); }],
      [480, () => { figure.classList.remove("asleep"); chips[i].classList.remove("asleep");
                    replay(nameEl, "collapse"); }],
      [760, () => {}],
      [880, () => {}]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      figure.classList.remove("asleep"); chips[i].classList.remove("asleep");
      chips[i].setAttribute("aria-label", `${u.name}, online. Cut in, then open dossier.`);
      announce(`${u.name} is online.`);
    });
  }

  shake.append(
    h("div", { class:"ci-split" }), h("div", { class:"ci-rule" }),
    band, figure,
    h("header", { class:"ci-head" },
      h("div", { class:"ci-kicker", html:"TAKE<b>/</b>OVER<br>THE FLEET" }),
      h("div", { class:"ci-sub" }, "04 UNITS · ALL-OUT ATTACK")),
    nameEl, ...ghosts, epi, chipRow
  );
  root.append(shake, ...furniture(.05));
  select(0);
  return root;
}

/* ---------------------------------------------------------------------
   08 · GIG FLYER — the VIEWTRADE riso one-man live
   One pinned SVG duotone presses all four portraits into the same inks.
   ------------------------------------------------------------------ */
function buildFlyer(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-flyer", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:absolute;inset:0;overflow:hidden" });
  const panelBox = h("div", { class:"gf-panels" });
  const PANEL = [
    { l:8,  t:2,  w:42, h:40, rot:-1.5, lx:"10%", ly:"38%" },
    { l:50, t:0,  w:46, h:34, rot:1.2,  lx:"52%", ly:"30%" },
    { l:3,  t:44, w:45, h:50, rot:1.6,  lx:"5%",  ly:"90%" },
    { l:47, t:38, w:50, h:56, rot:-1,   lx:"49%", ly:"90%" }
  ];
  const panels = [];

  us.forEach((u, i) => {
    const p = PANEL[i];
    const btn = h("button", {
      type:"button", class:"gf-panel ring",
      style:`left:${p.l}%; top:${p.t}%; width:${p.w}%; height:${p.h}%;` +
            `transform:rotate(${p.rot}deg); --focus:${u.focus}; z-index:${i + 1}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      h("img", { src:u.art, alt:"", decoding:"async" }),
      h("span", { class:"tone-ramp", style:`--ramp-angle:${140 + i * 20}deg` }),
      h("span", { class:"gf-mis" })
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    panels.push(btn);
    panelBox.append(btn);
    panelBox.append(h("span", {
      class:"gf-label", style:`left:${p.lx}; top:${p.ly}; z-index:${10 + i}`, "aria-hidden":"true",
      html:`<b>${u.prefix}</b> ${u.name}`
    }));
  });
  panelBox.append(
    h("span", { class:"gf-burst", style:"right:2%; top:26%" }),
    h("span", { class:"gf-burst", style:"left:44%; top:1%; width:40px; height:40px" })
  );

  const stamp = h("span", { class:"gf-stamp" }, "1 STANDBY");

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:"#ff2e93", skin:"print" }); return; }
    const btn = panels[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); announce(`Second ink plate registering for ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); }],
      [520, () => { btn.classList.remove("asleep"); }],
      [700, () => { stamp.textContent = "ALL 4 UP"; replay(stamp, "thud"); }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep", "waking");
      btn.setAttribute("aria-label", labelFor(us[i]));
      stamp.textContent = "ALL 4 UP";
      announce(`${u.name} pressed in full colour. Online.`);
    });
  }

  shake.append(
    h("div", { class:"gf-paper" }),
    panelBox,
    h("div", { class:"gf-stub" },
      h("div", { class:"gf-stub-t", html:"26.08.07<br>CTRL/B<br>LAN LIVE" }),
      h("div", { class:"gf-qr" })),
    stamp,
    h("div", { class:"gf-tickets" }, "TICKETS · TAILNET ONLY"),
    h("div", { class:"gf-type" },
      h("h2", { class:"gf-word" }, "CTRL/B"),
      h("div", { class:"gf-oneman" }, "ONEMAN LIVE"),
      h("div", { class:"gf-loading" }, "-LOADING NOW!!-"),
      h("div", { class:"gf-date" }, "2026.08.07 (Fri) EMMA · TAILNET SHELTER"),
      h("div", { class:"gf-times" }, "WAKE 18:30  START 19:00  PING 07ms"),
      h("div", { class:"gf-price" }, "前売り 4 UNITS / 当日 T.B.A.（入場時 WOL パケット必要）"))
  );
  root.append(shake, ...furniture(.09));
  return root;
}

/* ---------------------------------------------------------------------
   09 · MANGA COLLAGE — the Double Dragon comic page
   Hand-authored polygons, N=4 fixed. This form has no generator (R18).
   ------------------------------------------------------------------ */
function buildManga(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-manga", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:absolute;inset:0;overflow:hidden" });
  const page = h("div", { class:"mg-page" });
  const PANEL = [
    { l:1,  t:1,  w:54, h:33, rot:-2,
      poly:"polygon(4% 0, 97% 5%, 100% 88%, 92% 100%, 5% 96%, 0 46%)",
      field:"#ffd23f", nx:"8px", ny:"auto", nb:"8px", nrot:-3 },
    { l:52, t:0,  w:47, h:29, rot:1.4,
      poly:"polygon(0 6%, 96% 0, 100% 92%, 8% 100%)",
      field:"#3fe0e8", nx:"auto", nr:"8px", ny:"6px", nrot:2 },
    { l:44, t:28, w:55, h:47, rot:-1,
      poly:"polygon(2% 4%, 100% 0, 96% 94%, 6% 100%, 0 52%)",
      field:"#ff4f9a", nx:"auto", nr:"10px", nb:"10px", nrot:-2 },
    { l:0,  t:35, w:48, h:44, rot:2,
      poly:"polygon(6% 0, 100% 6%, 94% 100%, 3% 92%, 0 40%)",
      field:"#7b6bff", nx:"10px", nb:"12px", nrot:3 }
  ];
  const panels = [];

  us.forEach((u, i) => {
    const p = PANEL[i];
    const zzz = h("span", { class:"mg-zzz", "aria-hidden":"true" },
      h("span", null, "z"), h("span", null, "z"), h("span", null, "Z"));
    const btn = h("button", {
      type:"button", class:"mg-panel ring",
      style:`left:${p.l}%; top:${p.t}%; width:${p.w}%; height:${p.h}%;` +
            `--rot:${p.rot}; --poly:${p.poly}; --field:${p.field}; --focus:${u.focus}; z-index:${6 - i}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      h("span", { class:"mg-clip" }, h("img", { src:u.art, alt:"", decoding:"async" })),
      h("span", { class:"mg-tone tone-ramp" }),
      h("span", { class:"mg-speed" }),
      u.status !== "ONLINE" ? zzz : null,
      h("span", { class:"mg-bang" }, "WAKE!!")
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    panels.push({ btn, zzz });
    page.append(btn);
    /* names live in page space so they can cross the panel gutters */
    page.append(h("span", {
      class:"mg-name", "aria-hidden":"true",
      style:`left:${p.l + 4}%; top:${p.t + p.h - 11}%; --nrot:${p.nrot}; z-index:${11 - i}`,
      html:`${u.name.toUpperCase()}<em>${u.jp} · ${u.role}</em>`
    }));
  });

  /* this sticker sits on panel 2's art — it must tell that panel's TRUTH
     (decoration never contradicts real status, R23 §A8) */
  const stateSticker = h("span",
    { class:"mg-sticker cyan", style:"right:2%; top:41%; --srot:4; z-index:14" },
    us[2].status === "ONLINE" ? "ONLINE!" : "STANDBY");
  page.append(
    h("span", { class:"mg-sticker", style:"left:5%; top:80%; --srot:-9; z-index:14" }, "04 UNITS"),
    h("span", { class:"mg-sticker pink", style:"right:5%; top:81%; --srot:7; z-index:14" }, "TAILNET"),
    stateSticker
  );

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:u.accent, skin:"hard" }); return; }
    const { btn, zzz } = panels[i];
    runCeremony(root, [
      [0,   () => { btn.classList.add("waking"); announce(`Waking ${u.name}.`); }],
      [180, () => { fireFlash(root); fireShake(shake); }],
      [520, () => { btn.classList.remove("asleep"); zzz.remove(); }],
      [880, () => { btn.classList.remove("waking"); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      btn.classList.remove("asleep", "waking"); zzz.remove();
      btn.setAttribute("aria-label", labelFor(us[i]));
      if (i === 2) stateSticker.textContent = "ONLINE!";
      announce(`${u.name} is online.`);
    });
  }

  shake.append(page,
    h("div", { class:"mg-title" },
      h("h2", { html:"CTRL<em>/</em>B CLUB" }),
      h("p", { html:"SERIES 2026 · FOUR MACHINES · ALL RIGHTS RESERVED<br>REPRODUCTION IN WHOLE OR IN PART IS PROHIBITED" })));
  root.append(shake, ...furniture(.06));
  return root;
}

/* ---------------------------------------------------------------------
   10 · CAPSULE DOME — the gashapon machine itself (R24 C-①)
   The crank IS the wake control: it resists, then gives.
   ------------------------------------------------------------------ */
function buildDome(cid){
  let us = unitsFor(cid);
  const root = h("section", { class:"screen c-dome", "data-concept":cid });
  const shake = h("div", { class:"shake", style:"position:relative" });
  const caps = h("div", { class:"cd-caps" });
  const SLOT = [{ x:46, y:112 }, { x:130, y:68 }, { x:216, y:116 }, { x:124, y:174 }];
  const capEls = [];

  us.forEach((u, i) => {
    const s = SLOT[i];
    const btn = h("button", {
      type:"button", class:"cd-cap ring",
      style:`--cx:${s.x}px; --cy:${s.y}px; --accent:${u.accent}; --focus:${u.focus}`,
      "aria-label":labelFor(u), onclick:() => tap(i)
    },
      h("span", { class:"cd-shellwrap" },
        h("span", { class:"cd-art" }, h("img", { src:u.art, alt:"", decoding:"async" }))),
      h("span", { class:"cd-half top" }), h("span", { class:"cd-half bot" }),
      h("span", { class:"cd-seam" }),
      h("span", { class:"cd-serial" }, u.serial)
    );
    if (u.status !== "ONLINE") btn.classList.add("asleep");
    capEls.push(btn);
    caps.append(btn);
  });

  const crank = h("button", {
    type:"button", class:"cd-crank ring",
    "aria-label":"Turn the crank to wake the sleeping capsule",
    onclick:() => { const i = us.findIndex(u => u.status !== "ONLINE");
                    if (i < 0){ announce("Every capsule is already open."); return; } tap(i); }
  });
  const chute = h("div", { class:"cd-chute" }, h("span", null, "PULL OUT"));
  const machine = h("div", { class:"cd-machine" },
    h("div", { class:"cd-topper" }, h("span"), "PUSH · TURN · WAKE", h("span")),
    h("div", { class:"cd-glass" },
      h("div", { class:"cd-dome" }, h("div", { class:"halftone" })), caps),
    h("div", { class:"cd-body" },
      h("div", { class:"cd-plate" }, h("b", null, "CTRL/B"), h("span", null, "FOUR MACHINES · ¥0")),
      h("div", { class:"cd-slot" }), crank, chute,
      h("span", { class:"reg-mark", style:"left:6px; bottom:6px; color:#fff" }),
      h("span", { class:"reg-mark", style:"right:6px; bottom:6px; color:#fff" })));

  function tap(i){
    const u = us[i];
    if (u.status === "ONLINE"){ openDossier(u, { accent:u.accent, skin:"soft" }); return; }
    const cap = capEls[i];
    const cr = cap.getBoundingClientRect(), ch = chute.getBoundingClientRect();
    cap.style.setProperty("--dx", `${Math.round(ch.left + ch.width / 2 - cr.left - cr.width / 2)}px`);
    cap.style.setProperty("--dy", `${Math.round(ch.top + ch.height / 2 - cr.top - cr.height / 2)}px`);
    runCeremony(root, [
      [0,   () => { replay(crank, "turning"); announce(`Cranking. ${u.name} capsule releasing.`); }],
      [190, () => { fireShake(shake); }],
      [340, () => { cap.classList.add("dropping"); }],
      [690, () => { fireFlash(root); }],
      [700, () => { cap.classList.add("open", "popped"); cap.classList.remove("asleep"); }],
      [880, () => { settle(cap); }]
    ]).then(ok => {
      if (!ok) return;
      wake.set(cid, u.id); us = unitsFor(cid);
      cap.classList.remove("asleep");
      cap.setAttribute("aria-label", labelFor(us[i]));
      settle(cap);
      announce(`${u.name} capsule cracked open. Online.`);
    });
  }

  function settle(cap){
    cap.classList.remove("dropping", "popped", "open");
    cap.style.removeProperty("--dx"); cap.style.removeProperty("--dy");
    cap.style.opacity = "0";
    requestAnimationFrame(() => {
      cap.style.transition = "opacity 220ms var(--e-out)";
      cap.style.opacity = "";
      setTimeout(() => { cap.style.transition = ""; }, 260);
    });
  }

  shake.append(machine);
  root.append(
    h("header", { class:"cd-head" },
      h("div", { class:"cd-mark", html:"CAPSULE <em>ARCADE</em>" }),
      h("div", { class:"cd-sub" }, "ONE CRANK · ONE MACHINE")),
    h("div", { class:"cd-stagewrap" }, shake,
      h("span", { class:"cd-rail", "aria-hidden":"true" }, "CTRL/B")),
    h("div", { class:"cd-hint" }, "TAP A CAPSULE FOR ITS FILE · TURN THE CRANK TO WAKE"),
    ...furniture(.05)
  );
  return root;
}

/* =====================================================================
   7 · SWITCHER + BOOT
   ===================================================================== */
const CONCEPTS = [
  { num:"01", name:"SIGNAL BANDS",     build:buildSignal },
  { num:"02", name:"SLICE STACK",      build:buildSlice  },
  { num:"03", name:"CHARACTER SELECT", build:buildSelect },
  { num:"04", name:"THE DOCK",         build:buildDock   },
  { num:"05", name:"OPERATOR FILE",    build:buildFile   },
  { num:"06", name:"FLEET/4",          build:buildFleet4 },
  { num:"07", name:"THE CUT-IN",       build:buildCutIn  },
  { num:"08", name:"GIG FLYER",        build:buildFlyer  },
  { num:"09", name:"MANGA COLLAGE",    build:buildManga  },
  { num:"10", name:"CAPSULE DOME",     build:buildDome   }
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
    built[i] = c.build(c.num);
    screensEl.append(built[i]);
  }
  built.forEach((el, k) => el && el.classList.toggle("is-active", k === i));
  current = i;
  swIndex.textContent = `${c.num}/10`;
  swName.textContent = `${c.num} · ${c.name}`;
  replay(swName, "show");
  const hash = "#" + c.num;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  if (announceIt) announce(`Concept ${c.num}, ${c.name}. Four machines, one sleeping.`);
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

document.addEventListener("keydown", e => {
  if (!dsr.layer.hidden) return;
  if (e.key === "ArrowLeft"){ e.preventDefault(); show(current - 1); }
  else if (e.key === "ArrowRight"){ e.preventDefault(); show(current + 1); }
});
window.addEventListener("hashchange", () => {
  const i = CONCEPTS.findIndex(c => c.num === location.hash.replace("#", ""));
  if (i >= 0) show(i);
});

const startNum = location.hash.replace("#", "");
const startIdx = Math.max(0, CONCEPTS.findIndex(c => c.num === startNum));
show(startIdx, { announceIt:false });

})();
