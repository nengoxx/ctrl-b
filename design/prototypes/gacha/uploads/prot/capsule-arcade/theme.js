
const layer=document.querySelector('.detail-layer'), panel=layer.querySelector('.detail-panel'), reel=document.querySelector('.reel-transition'), detailImg=panel.querySelector('[data-detail-img]'), detailRar=panel.querySelector('[data-detail-rar]');
const ART={pegasus:'../assets/gacha/pegasus.jpg',atlas:'../assets/gacha/atlas.jpg',rook:'../assets/gacha/rook.png',lyra:'../assets/gacha/lyra.png'};
const RAR={pegasus:'★★★',atlas:'★★★',rook:'★★',lyra:'★★★'};
const cardImg=id=>{const c=document.querySelector(`.capsule-card[data-host="${id}"]`);return c&&c.querySelector('img')};
function openHost(id,el){if(layer.classList.contains('open'))return;const h=PROTO.byId(id),from=el.querySelector('img');PROTO.state.selected=id;from.style.viewTransitionName='capsule-shell';PROTO.vt(()=>{from.style.viewTransitionName='';detailImg.style.viewTransitionName='capsule-shell';PROTO.fillDetail(panel,h,ART[id]);detailRar.textContent=RAR[id];layer.classList.add('open');layer.setAttribute('aria-hidden','false')},'detail').finally(()=>{from.style.viewTransitionName='';detailImg.style.viewTransitionName=''})}
function closeDetail(silent=false){if(!layer.classList.contains('open'))return;const to=PROTO.state.selected&&cardImg(PROTO.state.selected);const shut=()=>{layer.classList.remove('open');layer.setAttribute('aria-hidden','true')};PROTO.state.selected=null;if(silent||!to){shut();return}detailImg.style.viewTransitionName='capsule-shell';PROTO.vt(()=>{detailImg.style.viewTransitionName='';to.style.viewTransitionName='capsule-shell';shut()},'detail').finally(()=>{detailImg.style.viewTransitionName='';to.style.viewTransitionName=''})}
document.querySelectorAll('.capsule-card').forEach(el=>el.addEventListener('click',()=>openHost(el.dataset.host,el)));layer.querySelector('.close-detail').onclick=()=>closeDetail();layer.querySelector('.detail-backdrop').onclick=()=>closeDetail();PROTO.onEscape(closeDetail);PROTO.bindNav({closeDetail,before(){reel.classList.remove('go');void reel.offsetWidth;reel.classList.add('go')}});PROTO.bindSettings();
document.querySelectorAll('[data-setting="wallpaper"]').forEach(b=>b.addEventListener('click',()=>{const on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));document.body.dataset.wallpaper=on?'on':'off'}));

const bTrack=document.querySelector('.banner-track'),bDots=[...document.querySelectorAll('.banner-dots i')];let bIdx=0,bTimer;
function bGo(n){bIdx=(n+bDots.length)%bDots.length;bTrack.style.transform=`translateX(${-bIdx*100}%)`;bDots.forEach((d,i)=>d.classList.toggle('on',i===bIdx))}
function bLoop(){clearInterval(bTimer);bTimer=setInterval(()=>{if(PROTO.state.tab==='fleet'&&!document.hidden)bGo(bIdx+1)},5200)}
bDots.forEach((d,i)=>d.addEventListener('click',()=>{bGo(i);bLoop()}));
document.querySelector('.banner').addEventListener('click',e=>{if(e.target.closest('.banner-dots'))return;bGo(bIdx+1);bLoop()});
bLoop();

const agentScreen=document.querySelector('.screen[data-screen="agent"]'),oracleEl=document.querySelector('.oracle');
function oracleScroll(){if(document.body.dataset.oracle!=='fade'){oracleEl.style.opacity='';oracleEl.style.filter='';oracleEl.style.transform='';return}
  const p=Math.min(1,agentScreen.scrollTop/240);oracleEl.style.opacity=String(1-p*.72);oracleEl.style.filter=`blur(${(p*5).toFixed(2)}px)`;oracleEl.style.transform=`scale(${(1+p*.06).toFixed(3)})`}
agentScreen.addEventListener('scroll',oracleScroll,{passive:true});
document.querySelectorAll('[data-setting="oracle"]').forEach(b=>b.addEventListener('click',()=>{const on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));document.body.dataset.oracle=on?'fade':'scroll';oracleScroll()}));
