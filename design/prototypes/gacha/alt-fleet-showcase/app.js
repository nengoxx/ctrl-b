const ART_ROOT = "./assets";

const units = [
  {
    id: "pegasus",
    name: "Pegasus",
    jp: "天馬",
    role: "WORKSTATION",
    status: "ONLINE",
    ping: "18 ms",
    seen: "now",
    stars: 5,
    art: `${ART_ROOT}/pegasus.webp`,
    focus: "50% 26%",
    tone: "pink",
    services: ["Hermes", "ComfyUI", "Open WebUI", "File relay", "Speaches"],
    crop: "Diagonal full-body pose. Excellent vertical card; horizontal bands must bias upward so the face survives."
  },
  {
    id: "atlas",
    name: "Atlas",
    jp: "地図",
    role: "HOME SERVER",
    status: "ONLINE",
    ping: "7 ms",
    seen: "now",
    stars: 4,
    art: `${ART_ROOT}/atlas.webp`,
    focus: "50% 26%",
    tone: "ice",
    services: ["Storage", "Backups", "Jellyfin", "Home bridge"],
    crop: "Centered portrait with expressive hands. Strong in tall frames; use a face-led crop in narrow bands."
  },
  {
    id: "rook",
    name: "Rook",
    jp: "塔",
    role: "MINI NODE",
    status: "SLEEPING",
    ping: "—",
    seen: "2h ago",
    stars: 2,
    art: `${ART_ROOT}/3.webp`,
    focus: "50% 24%",
    tone: "violet",
    services: ["Wake relay", "Build runner"],
    crop: "Current app slot 3: centered hooded portrait. Face-led bands work well; tall cards preserve the full silhouette."
  },
  {
    id: "lyra",
    name: "Lyra",
    jp: "琴",
    role: "MEDIA VAULT",
    status: "ONLINE",
    ping: "12 ms",
    seen: "now",
    stars: 3,
    art: `${ART_ROOT}/4.webp`,
    focus: "50% 8%",
    tone: "coral",
    services: ["Media", "Archive", "Sync"],
    crop: "Current app slot 4: seated full-body portrait. Uses the production roster's 50% 8% focal point to protect the face and ears."
  }
];

const variants = [
  {
    id: "signal-bands",
    label: "Signal Bands",
    kicker: "Generated diagonal roster",
    fit: "strong-fit",
    strength: "One poster, one constant shear, one real button per host. It scales cleanly with fleet count and keeps the current dossier seam obvious.",
    risk: "Faces need per-image focus values. Too-short bands turn Pegasus and Atlas into eye-only crops.",
    render: renderSignalBands
  },
  {
    id: "name-blades",
    label: "Name Blades",
    kicker: "ZZZ-style framed character bands",
    fit: "expressive",
    strength: "The oversized name bars make machines identifiable before the art resolves and carry the strongest game-poster identity.",
    risk: "Diagonal labels consume image area and long host names need a smaller fallback rung.",
    render: renderNameBlades
  },
  {
    id: "true-damage",
    label: "True Damage Stack",
    kicker: "Cinematic slice poster",
    fit: "strong-fit",
    strength: "A restrained ensemble silhouette: equal image slices, one title rail, little per-item chrome. Status reads through color versus mono.",
    risk: "It is more poster than dashboard; status chips and stars must stay quiet or the composition collapses into labels.",
    render: renderTrueDamage
  },
  {
    id: "manga-grid",
    label: "Manga Grid",
    kicker: "Template-driven comic cells",
    fit: "divergent",
    strength: "Controlled asymmetry gives manga rhythm without random geometry. Four fixed roles can repeat for larger fleets.",
    risk: "Visual importance varies by slot. Poll-driven reordering would feel like editorial reshuffling, so host order must remain stable.",
    render: renderMangaGrid
  },
  {
    id: "selector-rail",
    label: "Selector Rail",
    kicker: "Active character + roster strip",
    fit: "conservative",
    strength: "The clearest character-selector model and the gentlest path to production. Thumbnail selects; the large portrait opens the dossier.",
    risk: "Only one machine is fully visible at once, so fleet-wide status comparison is weaker than in the poster variants.",
    render: renderSelectorRail
  },
  {
    id: "arcade-versus",
    label: "Arcade Versus",
    kicker: "Paired selection marquee",
    fit: "experimental",
    strength: "Feels tactile and game-like while showing two machines at useful scale. Previous/next can map naturally to swipe later.",
    risk: "Pairing implies competition that the product does not actually have; not ideal if the fleet is primarily monitored at a glance.",
    render: renderArcadeVersus
  },
  {
    id: "cover-story",
    label: "Cover Story",
    kicker: "One hero + supporting cut-ins",
    fit: "art-led",
    strength: "The strongest manga-cover composition. The hero machine becomes a deliberate daily-use favorite while all others remain one tap away.",
    risk: "Hierarchy is product meaning. Rotating the hero randomly would be noisy; it needs a stable favorite or configured lead host.",
    render: renderCoverStory
  },
  {
    id: "contact-sheet",
    label: "Contact Sheet",
    kicker: "Dense manga roster",
    fit: "low-risk",
    strength: "All hosts remain equally reachable, art stays legible, and the layout handles 1–8 items with the least geometry risk.",
    risk: "It is the least transformative option and can drift back toward ordinary cards if the gutters and type lose their editorial edge.",
    render: renderContactSheet
  }
];

let activeVariant = 0;
let activeUnitId = units[0].id;
let lastOpener = null;

const tabs = document.querySelector("#variant-tabs");
const stage = document.querySelector("#fleet-stage");
const shell = document.querySelector(".prototype-shell");
const selectionStatus = document.querySelector("#selection-status");
const layer = document.querySelector("#dossier-layer");
const dialog = layer.querySelector(".dossier");
const primaryAction = document.querySelector("#primary-action");
const dossierFeedback = document.querySelector("#dossier-feedback");

function esc(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}

function stars(unit) {
  return `<span class="unit-stars" aria-label="${unit.stars} stars">${Array.from({ length: unit.stars }, () => "<i>★</i>").join("")}</span>`;
}

function state(unit) {
  return `<span class="unit-state ${unit.status === "ONLINE" ? "on" : "sleep"}">${unit.status}</span>`;
}

function image(unit) {
  return `<img src="${unit.art}" alt="" draggable="false" style="object-position:${unit.focus}">`;
}

function targetLabel(unit) {
  return `Open ${unit.name} dossier, ${unit.status.toLowerCase()}, ${unit.stars} stars`;
}

function renderSignalBands() {
  return `<div class="composition signal-bands">
    <div class="poster-label"><b>編成</b><span>FLEET SIGNAL</span></div>
    <div class="band-stack">
      ${units.map((unit, i) => `<button class="unit-target signal-band tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" style="--i:${i}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}">
        <span class="band-drop"></span><span class="band-face">${image(unit)}<span class="band-wash"></span><span class="band-copy"><b>${unit.name}</b><small>${unit.role}</small></span>${stars(unit)}${state(unit)}</span>
      </button>`).join("")}
    </div>
  </div>`;
}

function renderNameBlades() {
  return `<div class="composition name-blades">
    <div class="blade-mast"><span>CONTROL</span><b>UNIT SELECT</b><small>機体を選択</small></div>
    <div class="blade-stack">
      ${units.map((unit, i) => `<button class="unit-target blade-panel tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}" style="--i:${i}">
        ${image(unit)}<span class="blade-frame"></span><span class="blade-name"><b>${unit.name}</b><small>${unit.jp}</small></span>${state(unit)}
      </button>`).join("")}
    </div>
  </div>`;
}

function renderTrueDamage() {
  return `<div class="composition damage-poster">
    <div class="damage-rail"><b>CTRL/B</b><span>FLEET</span><small>SELECT</small></div>
    <div class="damage-stack">
      ${units.map((unit, i) => `<button class="unit-target damage-slice tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}" style="--i:${i}">
        ${image(unit)}<span class="damage-scrim"></span><span class="damage-copy"><b>${unit.name}</b><small>${unit.ping}</small></span>${stars(unit)}
      </button>`).join("")}
    </div>
    <span class="damage-footer">NETWORK ENSEMBLE · 04 SIGNALS</span>
  </div>`;
}

function renderMangaGrid() {
  return `<div class="composition manga-grid">
    <header><b>FLEET<br>ISSUE 04</b><span>機体名簿</span><small>Tap a panel to inspect</small></header>
    <div class="manga-cells">
      ${units.map((unit, i) => `<button class="unit-target manga-cell cell-${i + 1} tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}">
        ${image(unit)}<span class="halftone"></span><span class="manga-caption"><b>${unit.name}</b><small>${unit.jp} · ${unit.status}</small></span>${i === 2 ? "<span class=burst>ZZZ</span>" : ""}
      </button>`).join("")}
    </div>
  </div>`;
}

function renderSelectorRail() {
  const active = units.find(unit => unit.id === activeUnitId) || units[0];
  return `<div class="composition selector-rail">
    <div class="selector-active tone-${active.tone} ${active.status === "ONLINE" ? "" : "is-sleeping"}">
      <button class="unit-target selector-hero" data-unit="${active.id}" aria-label="${targetLabel(active)}">
        ${image(active)}<span class="selector-wash"></span>
        <span class="selector-index">0${units.indexOf(active) + 1}</span>
        <span class="selector-copy"><small>${active.role}</small><b>${active.name}</b><i>${active.jp}</i></span>
        ${stars(active)}${state(active)}
      </button>
    </div>
    <div class="selector-thumbs" role="radiogroup" aria-label="Choose active unit">
      ${units.map((unit, i) => `<button type="button" role="radio" class="selector-thumb ${unit.id === active.id ? "active" : ""}" data-select-unit="${unit.id}" aria-checked="${unit.id === active.id}" aria-label="Select ${unit.name}, ${unit.status.toLowerCase()}, ${unit.stars} stars">
        ${image(unit)}<span>0${i + 1}</span><b>${unit.name}</b><i class="${unit.status === "ONLINE" ? "on" : ""}"></i>
      </button>`).join("")}
    </div>
    <p class="selector-hint">Choose below · tap the large portrait for dossier</p>
  </div>`;
}

function renderArcadeVersus() {
  const index = Math.max(0, units.findIndex(unit => unit.id === activeUnitId));
  const active = units[index];
  const next = units[(index + 1) % units.length];
  return `<div class="composition arcade-versus">
    <header><span>ARCADE LINK</span><b>PAIR SELECT</b><small>${String(index + 1).padStart(2, "0")}—${String((index + 1) % units.length + 1).padStart(2, "0")}</small></header>
    <div class="versus-pair">
      ${[active, next].map((unit, i) => `<button class="unit-target versus-unit ${i ? "challenger" : "lead"} tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}">
        ${image(unit)}<span class="versus-shade"></span><span class="versus-copy"><small>${unit.role}</small><b>${unit.name}</b>${stars(unit)}</span>${state(unit)}
      </button>`).join("")}
      <span class="versus-mark" aria-hidden="true">×</span>
    </div>
    <div class="versus-controls"><button type="button" data-cycle="-1">← PREV</button><span>SELECT A UNIT</span><button type="button" data-cycle="1">NEXT →</button></div>
  </div>`;
}

function renderCoverStory() {
  const hero = units.find(unit => unit.id === activeUnitId) || units[0];
  const support = units.filter(unit => unit.id !== hero.id);
  return `<div class="composition cover-story tone-${hero.tone}">
    <div class="cover-title"><span>CTRL/B</span><b>FLEET<br>STORY</b><small>ISSUE 04 · ${hero.status}</small></div>
    <button class="unit-target cover-hero ${hero.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${hero.id}" aria-label="${targetLabel(hero)}">
      ${image(hero)}<span class="cover-hero-copy"><small>FEATURED UNIT</small><b>${hero.name}</b><i>${hero.jp}</i></span>${stars(hero)}
    </button>
    <div class="cover-cutins">
      ${support.map((unit, i) => `<button class="unit-target cover-cutin cutin-${i + 1} tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}">
        ${image(unit)}<span><b>${unit.name}</b><small>${unit.status}</small></span>
      </button>`).join("")}
    </div>
    <button class="cover-cycle" type="button" data-cycle="1">CHANGE COVER →</button>
  </div>`;
}

function renderContactSheet() {
  return `<div class="composition contact-sheet">
    <header><span>CTRL/B ARCHIVE</span><b>UNIT CONTACTS</b><small>VOL.04</small></header>
    <div class="contact-grid">
      ${units.map((unit, i) => `<button class="unit-target contact-card tone-${unit.tone} ${unit.status === "ONLINE" ? "" : "is-sleeping"}" data-unit="${unit.id}" aria-label="${targetLabel(unit)}">
        <span class="contact-no">0${i + 1}</span>${image(unit)}<span class="contact-ink"></span><span class="contact-copy"><b>${unit.name}</b><small>${unit.role}</small></span>${state(unit)}
      </button>`).join("")}
    </div>
  </div>`;
}

function renderTabs() {
  tabs.innerHTML = variants.map((variant, i) => `<button type="button" data-variant="${i}" aria-current="${i === activeVariant ? "true" : "false"}"><span>${String(i + 1).padStart(2, "0")}</span>${variant.label}</button>`).join("");
}

function renderStage() {
  const variant = variants[activeVariant];
  document.querySelector("#variant-number").textContent = `${String(activeVariant + 1).padStart(2, "0")} / ${String(variants.length).padStart(2, "0")}`;
  document.querySelector("#variant-title").textContent = variant.label;
  document.querySelector("#variant-kicker").textContent = variant.kicker;
  document.querySelector("#fit-badge").textContent = variant.fit;
  document.querySelector("#fit-badge").dataset.fit = variant.fit;
  document.querySelector("#variant-strength").textContent = variant.strength;
  document.querySelector("#variant-risk").textContent = variant.risk;
  stage.dataset.variant = variant.id;
  stage.innerHTML = variant.render();
  renderTabs();
}

function renderCropAudit() {
  document.querySelector("#crop-grid").innerHTML = units.map(unit => `<article class="crop-card">
    <div><img src="${unit.art}" alt="" style="object-position:${unit.focus}"><span>${unit.name}</span></div>
    <p>${unit.crop}</p>
  </article>`).join("");
}

function openDossier(unitId, opener) {
  const unit = units.find(item => item.id === unitId);
  if (!unit) return;
  lastOpener = opener;
  document.querySelector("#dossier-image").src = unit.art;
  document.querySelector("#dossier-image").style.objectPosition = unit.focus;
  document.querySelector("#dossier-name").textContent = unit.name;
  document.querySelector("#dossier-role").textContent = `${unit.role} · ${unit.jp} · ${unit.status} · ${unit.stars}★`;
  document.querySelector("#dossier-stars").innerHTML = Array.from({ length: unit.stars }, () => "<i>★</i>").join("");
  document.querySelector("#dossier-metrics").innerHTML = [
    [unit.ping, "Ping", "応答"],
    [unit.services.length, "Services", "サービス"],
    [unit.seen, "Seen", "最終確認"],
    [unit.status === "ONLINE" ? "UP" : "IDLE", "State", "状態"]
  ].map(([value, label, jp]) => `<div><b>${esc(value)}</b><span>${label}<i>${jp}</i></span></div>`).join("");
  document.querySelector("#dossier-services").innerHTML = unit.services.map((service, i) => `<div><i class="${unit.status === "ONLINE" && i < Math.max(1, unit.services.length - 1) ? "on" : ""}"></i><b>${esc(service)}</b><span>${unit.status === "ONLINE" ? (i === unit.services.length - 1 ? "idle" : "healthy") : "offline"}</span></div>`).join("");
  primaryAction.textContent = unit.status === "ONLINE" ? "Simulate reboot" : "Simulate wake";
  primaryAction.disabled = false;
  dossierFeedback.textContent = "";
  shell.inert = true;
  layer.hidden = false;
  document.body.classList.add("dossier-open");
  requestAnimationFrame(() => dialog.focus({ preventScroll: true }));
}

function closeDossier() {
  if (layer.hidden) return;
  layer.hidden = true;
  document.body.classList.remove("dossier-open");
  shell.inert = false;
  if (lastOpener?.isConnected) lastOpener.focus({ preventScroll: true });
  lastOpener = null;
}

function cycleUnit(delta) {
  const index = Math.max(0, units.findIndex(unit => unit.id === activeUnitId));
  activeUnitId = units[(index + delta + units.length) % units.length].id;
  renderStage();
  stage.querySelector(`[data-cycle="${delta}"]`)?.focus({ preventScroll: true });
  const unit = units.find(item => item.id === activeUnitId);
  selectionStatus.textContent = `${unit.name} selected`;
}

tabs.addEventListener("click", event => {
  const button = event.target.closest("[data-variant]");
  if (!button) return;
  activeVariant = Number(button.dataset.variant);
  renderStage();
  tabs.querySelector(`[data-variant="${activeVariant}"]`)?.focus({ preventScroll: true });
  selectionStatus.textContent = `${variants[activeVariant].label} variant selected`;
});

stage.addEventListener("click", event => {
  const target = event.target.closest("[data-unit]");
  if (target) {
    openDossier(target.dataset.unit, target);
    return;
  }
  const select = event.target.closest("[data-select-unit]");
  if (select) {
    activeUnitId = select.dataset.selectUnit;
    renderStage();
    stage.querySelector(`[data-select-unit="${activeUnitId}"]`)?.focus({ preventScroll: true });
    const unit = units.find(item => item.id === activeUnitId);
    selectionStatus.textContent = `${unit.name} selected`;
    return;
  }
  const cycle = event.target.closest("[data-cycle]");
  if (cycle) cycleUnit(Number(cycle.dataset.cycle));
});

layer.addEventListener("click", event => {
  if (event.target.closest("[data-close-dossier]") || event.target.closest(".quiet")) closeDossier();
});

primaryAction.addEventListener("click", () => {
  dossierFeedback.textContent = "Prototype only — no command was sent.";
  primaryAction.textContent = "Demo acknowledged";
  primaryAction.disabled = true;
});

document.addEventListener("keydown", event => {
  if (layer.hidden) return;
  if (event.key === "Escape") {
    closeDossier();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault();
    first.focus();
  }
});

renderCropAudit();
renderStage();
