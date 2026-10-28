import type { El, LaidDeck } from './design';

/*
 * The same laid-out deck as one self-contained HTML file: a little slideshow player (arrow keys or
 * click to move, F for full screen). It is what Ultron saves when Google isn't connected, and how
 * a deck's design is checked by eye before it goes to Google. Pure, for tests.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function el(e: El): string {
  const pos = `left:${e.x}pt;top:${e.y}pt;width:${e.w}pt;height:${e.h}pt`;
  if (e.kind === 'rect') return `<div class="r" style="${pos};background:${e.fill};${e.alpha !== undefined ? `opacity:${e.alpha};` : ''}border-radius:${e.ellipse ? '50%' : e.round ? '10pt' : '0'}"></div>`;
  if (e.kind === 'image') return `<img class="i" src="${esc(e.url)}" style="${pos}" alt="">`;
  const just = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start';
  const body = e.bullets
    ? `<ul>${e.text.split('\n').map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    : esc(e.text).replace(/\n/g, '<br>');
  return `<div class="t" style="${pos};justify-content:${just};text-align:${e.align ?? 'left'};font:${e.italic ? 'italic ' : ''}${e.bold ? 700 : 400} ${e.size}pt/${e.bullets ? 1.3 : 1.18} '${e.font}',sans-serif;color:${e.color};${e.caps ? `text-transform:uppercase;letter-spacing:${e.spacing ?? 1}pt;` : ''}">${body}</div>`;
}

export function deckHtml(deck: LaidDeck): string {
  const fonts = [...new Set([deck.theme.head, deck.theme.body])].map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400`).join('&');
  const slides = deck.slides.map((s, i) => `<section class="s" data-n="${i + 1}" style="background:${s.bg}">${s.els.map(el).join('')}</section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden}
.deck{position:absolute;inset:0;display:grid;place-items:center}
.s{position:absolute;width:720pt;height:405pt;overflow:hidden;display:none;transform-origin:center;box-shadow:0 10px 60px rgba(0,0,0,.6)}
.s.on{display:block}
.r,.i,.t{position:absolute;box-sizing:border-box}
.i{object-fit:fill}
.t{display:flex;flex-direction:column;white-space:normal;word-wrap:break-word;margin:0}
.t ul{margin:0;padding-left:1.15em}.t li{margin:0 0 .45em}.t li::marker{color:${deck.theme.accent}}
.nav{position:fixed;bottom:10px;right:14px;color:#888;font:12px system-ui;opacity:.7}
</style></head><body><div class="deck">${slides}</div><div class="nav"></div>
<script>
const s=[...document.querySelectorAll('.s')];let i=0;const nav=document.querySelector('.nav');
function fit(){const k=Math.min(innerWidth/960,innerHeight/540)*0.96;s.forEach(x=>x.style.transform='scale('+k+')');}
function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,k)=>x.classList.toggle('on',k===i));nav.textContent=(i+1)+' / '+s.length+'  -  arrows to move, F for full screen';history.replaceState(null,'','#'+(i+1));}
addEventListener('hashchange',()=>show(Number(location.hash.slice(1))-1||0));
addEventListener('resize',fit);addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key))show(i+1);if(['ArrowLeft','PageUp'].includes(e.key))show(i-1);if(e.key==='f'||e.key==='F')document.documentElement.requestFullscreen?.();});
addEventListener('click',e=>show(e.clientX<innerWidth/3?i-1:i+1));
fit();show(Number(location.hash.slice(1))-1||0);
</script></body></html>`;
}
