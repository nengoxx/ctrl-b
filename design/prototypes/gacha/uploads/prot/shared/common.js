
window.PROTO = (() => {
  const hosts = [
    { id:'pegasus', name:'Pegasus', role:'Workstation', status:'ONLINE', ping:'18 ms', load:'37%', temp:'52°', uptime:'12d 08h', color:'#68e1ff', color2:'#8c7cff' },
    { id:'atlas', name:'Atlas', role:'Home Server', status:'ONLINE', ping:'7 ms', load:'62%', temp:'47°', uptime:'31d 21h', color:'#ff78b7', color2:'#ffb36a' },
    { id:'rook', name:'Rook', role:'Mini Node', status:'SLEEPING', ping:'—', load:'0%', temp:'31°', uptime:'—', color:'#a8ef6d', color2:'#4ad6a7' },
    { id:'lyra', name:'Lyra', role:'Media Vault', status:'ONLINE', ping:'12 ms', load:'21%', temp:'44°', uptime:'6d 03h', color:'#ff9ab0', color2:'#ffd9c4' },
  ];
  const state = { tab:'fleet', selected:null, motion:'full', perf:'full' };

  function byId(id) { return hosts.find(h => h.id === id); }
  function vt(update, type='nav') {
    if (state.motion === 'reduced' || !document.startViewTransition) { update(); return Promise.resolve(); }
    document.documentElement.dataset.transition = type;
    const t = document.startViewTransition(update);
    return t.finished.finally(() => delete document.documentElement.dataset.transition);
  }
  function switchTab(tab, hooks={}) {
    if (tab === state.tab) return;
    hooks.before?.(state.tab, tab);
    vt(() => {
      document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.dataset.screen === tab));
      document.querySelectorAll('.nav button').forEach(el => el.setAttribute('aria-selected', String(el.dataset.tab === tab)));
      state.tab = tab; document.body.dataset.tab = tab;
      if (tab !== 'fleet') hooks.closeDetail?.(true);
    }, `tab-${tab}`).then(() => hooks.after?.(tab));
  }
  function fillDetail(panel, host, assetPath) {
    panel.style.setProperty('--host', host.color);
    panel.style.setProperty('--host2', host.color2);
    const img = panel.querySelector('[data-detail-img]'); if (img && assetPath) img.src = assetPath;
    panel.querySelector('[data-detail-name]').textContent = host.name;
    panel.querySelector('[data-detail-role]').textContent = `${host.role} · ${host.status}`;
    panel.querySelector('[data-ping]').textContent = host.ping;
    panel.querySelector('[data-load]').textContent = host.load;
    panel.querySelector('[data-temp]').textContent = host.temp;
    panel.querySelector('[data-uptime]').textContent = host.uptime;
  }
  function bindSettings() {
    document.querySelectorAll('[data-setting="motion"]').forEach(btn => btn.addEventListener('click', () => {
      state.motion = state.motion === 'full' ? 'reduced' : 'full';
      document.body.dataset.motion = state.motion;
      document.querySelectorAll('[data-setting="motion"]').forEach(b => b.setAttribute('aria-checked', String(state.motion === 'full')));
    }));
    document.querySelectorAll('[data-setting="perf"]').forEach(btn => btn.addEventListener('click', () => {
      state.perf = state.perf === 'full' ? 'lite' : 'full';
      document.body.dataset.perf = state.perf;
      document.querySelectorAll('[data-setting="perf"]').forEach(b => b.setAttribute('aria-checked', String(state.perf === 'full')));
    }));
  }
  function bindNav(hooks={}) {
    document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab, hooks)));
  }
  function press(el) {
    if (state.motion === 'reduced') return;
    el.animate([{transform:'scale(1)'},{transform:'scale(.94)'},{transform:'scale(1.025)'},{transform:'scale(1)'}], {duration:360,easing:'cubic-bezier(.2,.9,.2,1)'});
  }
  function onEscape(fn) { addEventListener('keydown', e => { if (e.key === 'Escape') fn(); }); }
  return { hosts, state, byId, vt, switchTab, fillDetail, bindSettings, bindNav, press, onEscape };
})();
