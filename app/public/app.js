/* Yussè Clip — interfaz */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const LOGO = `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#FF5A36"/><path d="M16 14c4 0 8 3 10.5 8.5L32 34l5.5-11.5C40 17 44 14 48 14" fill="none" stroke="#FFF7EC" stroke-width="6" stroke-linecap="round"/><path d="M32 34v8c0 5-3 8-7 8" fill="none" stroke="#FFF7EC" stroke-width="6" stroke-linecap="round"/><path d="M38 41l10 6-10 6z" fill="#FFB020"/></svg>`;
const brandMark = () => `<a class="logo" href="#/">${LOGO}<span>Yussè <b>Clip</b></span></a>`;
const NETS = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube Shorts', linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook' };
const STYLES = { karaoke: 'Karaoke', caja: 'Caja', neon: 'Neón', minimal: 'Minimal', comic: 'Cómic' };
const LENGTHS = { auto: 'Automático', short: '15–30 s', mid: '30–60 s', long: '60–90 s', xl: '90 s – 3 min' };
const FILLERS = new Set(['eh', 'ehh', 'em', 'emm', 'mm', 'mmm', 'um', 'uh', 'uhm', 'erm', 'hmm']);
const isFiller = (w) => FILLERS.has(w.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim());
const EMOJI = [[/dinero|money|euros?|dólares?|pagar|precio/i, '💰'], [/fuego|brutal|increíble|épico|fire/i, '🔥'], [/idea|truco|consejo|tip/i, '💡'], [/jaja|risa|gracioso|funny/i, '😂'], [/amor|quiero|love|corazón/i, '❤️'], [/miedo|susto|terror/i, '😱'], [/error|mal|problema|fail/i, '⚠️'], [/tiempo|reloj|minutos?|horas?/i, '⏱️'], [/ganar|victoria|win|éxito/i, '🏆'], [/juego|partida|game|jugar/i, '🎮'], [/clase|aprender|estudiar|learn/i, '📚'], [/empresa|negocio|business|cliente/i, '💼'], [/música|canción|music/i, '🎵'], [/cohete|crecer|subir|growth/i, '🚀']];

let me = null, brand = {}, sock = null;
const listeners = new Set();
const pendingDownloads = new Set();
const renderState = {};

// ---------- utilidades ----------
async function api(url, opts = {}) {
  const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o);
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j?.error || 'Algo salió mal'); e.status = r.status; throw e; }
  return j;
}
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 5000 : 2800);
}
const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const fmtLong = (t) => { t = Math.round(t || 0); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return h ? `${h} h ${m} min` : `${m || 0} min ${t % 60 ? (t % 60) + ' s' : ''}`; };
const parseT = (s) => { if (s == null || String(s).trim() === '') return undefined; const p = String(s).split(':').map(Number); return p.reduce((a, b) => a * 60 + b, 0); };
const rangesDur = (rs) => rs.reduce((a, [s, e]) => a + (e - s), 0);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  onMount && onMount(bg, close);
  return close;
}
function scoreColor(v) { return v >= 80 ? 'var(--mint)' : v >= 60 ? 'var(--amber)' : 'var(--coral)'; }

// ---------- tiempo real ----------
function connect() {
  if (sock && sock.readyState <= 1) return;
  const base = location.pathname.replace(/[^/]*$/, '');
  sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + 'ws');
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'render') {
      renderState[m.clipId] = m;
      if (m.status === 'done' && pendingDownloads.has(m.clipId)) { pendingDownloads.delete(m.clipId); download(`media/clip/${m.clipId}?dl=1`); }
      if (m.status === 'error') { pendingDownloads.delete(m.clipId); toast('No se pudo montar el clip. Inténtalo de nuevo.', true); }
    }
    listeners.forEach((fn) => fn(m));
  };
  sock.onclose = () => { if (me) setTimeout(connect, 2500); };
}
function download(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }
function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let cleanup = [];
function onView(fn) { cleanup.push(on(fn)); }

// ---------- reproductor con subtitulos en vivo ----------
function keptIntervals(words, ranges, removeFillers) {
  if (!removeFillers) return ranges.map((r) => [...r]);
  const out = [];
  for (const [s, e] of ranges) {
    let cur = s;
    for (const w of words) { if (w.s < s || w.e > e) continue; if (isFiller(w.w)) { if (w.s - cur > 0.05) out.push([cur, w.s]); cur = w.e; } }
    if (e - cur > 0.05) out.push([cur, e]);
  }
  return out;
}
function groupWords(ws, maxWords, maxChars) {
  const groups = []; let g = [];
  ws.forEach((w, i) => {
    g.push(w);
    const next = ws[i + 1];
    if (g.length >= maxWords || g.map((x) => x.w).join(' ').length >= maxChars || /[.!?,;:]$/.test(w.w) || !next || next.s - w.e > 0.6) { groups.push(g); g = []; }
  });
  return groups;
}

function Player({ project, clip, words, compact }) {
  const st = clip.settings || {};
  const el = document.createElement('div');
  const aspectCls = { '1:1': 'a11', '4:5': 'a45', '16:9': 'a169' }[st.aspect] || '';
  el.className = `phone ${aspectCls} ${st.reframe === 'fit' ? 'fit' : ''}`;
  const start = clip.ranges[0][0];
  el.innerHTML = `${st.reframe === 'fit' ? `<div class="bgblur" style="background-image:url(media/p/${project.id}/thumb.jpg)"></div>` : ''}
    <video class="main" playsinline preload="metadata" src="media/p/${project.id}/preview.mp4#t=${start.toFixed(2)}"></video>
    <div class="ov"></div><button class="playbtn" aria-label="Reproducir"><span>▶</span></button><div class="dur"></div>`;
  const v = $('video', el), ov = $('.ov', el);
  let intervals, groups, total, raf = 0, tailTimer = 0, state = 'idle', cur = { ...clip };
  const rgx = /(.)/;
  function setup(c) {
    cur = c;
    const s = c.settings || {};
    intervals = keptIntervals(words, c.ranges, s.removeFillers);
    const ws = words.filter((w) => intervals.some(([a, b]) => w.s >= a - 0.01 && w.e <= b + 0.01) && !(s.removeFillers && isFiller(w.w)));
    const per = s.captionStyle === 'minimal' ? 7 : s.captionStyle === 'comic' ? 2 : 3;
    const W = { '16:9': 40, '1:1': 26 }[s.aspect] || 22;
    groups = groupWords(ws, per, W);
    total = rangesDur(intervals) / (s.speed || 1);
    $('.dur', el).textContent = fmt(total);
    el.style.setProperty('--hl', s.highlight || brand.accent || '#FFB020');
    el.style.setProperty('--capbox', brand.primary || '#FF5A36');
    el.style.setProperty('--brand', brand.primary || '#FF5A36');
    el.style.setProperty('--capfont', `"${brand.font || 'Montserrat'}"`);
    v.playbackRate = s.speed || 1;
    // encuadre
    const ratio = { '1:1': 1, '4:5': 0.8, '16:9': 16 / 9 }[s.aspect] || 9 / 16;
    const sr = (project.width || 16) / (project.height || 9);
    if (s.reframe !== 'fit' && sr > ratio) {
      const cw = ratio / sr, x = s.cropX ?? 0.5;
      const p = Math.min(1, Math.max(0, (x - cw / 2) / (1 - cw)));
      v.style.objectPosition = `${(p * 100).toFixed(1)}% 50%`;
    } else v.style.objectPosition = '50% 50%';
    el.className = `phone ${({ '1:1': 'a11', '4:5': 'a45', '16:9': 'a169' }[s.aspect] || '')} ${s.reframe === 'fit' ? 'fit' : ''} ${state === 'playing' ? 'playing' : ''}`;
    if (s.reframe === 'fit' && !$('.bgblur', el)) el.insertAdjacentHTML('afterbegin', `<div class="bgblur" style="background-image:url(media/p/${project.id}/thumb.jpg)"></div>`);
    drawOverlay(v.currentTime || intervals[0][0]);
  }
  function elapsed(t) {
    let acc = 0;
    for (const [a, b] of intervals) { if (t < a) break; if (t <= b) return (acc + t - a) / (cur.settings.speed || 1); acc += b - a; }
    return acc / (cur.settings.speed || 1);
  }
  function extras() {
    const s = cur.settings || {};
    const x = { hook: s.showHook === false ? '' : cur.hook };
    if (cur.thread_id != null) {
      const i = cur.part_index;
      x.badge = `${i + 1}/3`;
      if (i > 0 && s.recap) x.recap = s.recap;
      if (i < 2) { x.cliff = s.cliffhanger; x.card = { title: s.ctaTitle || `▶ Parte ${i + 2} en mi perfil`, line: s.ctaLine || 'Sígueme para no perderte lo que pasa', handle: brand.handle }; }
      else if (s.endCard !== false) x.card = { title: s.ctaTitle || 'Fin de la historia', line: s.ctaLine || '¿Te gustó? Sígueme para más', handle: brand.handle };
    } else if (brand.outro && s.brand !== false) x.card = { title: brand.outroTitle || brand.handle || 'Sígueme', line: brand.outroLine || 'Más clips en mi perfil', handle: brand.outroTitle ? brand.handle : '' };
    return x;
  }
  function drawOverlay(t, phase) {
    const s = cur.settings || {};
    const x = extras();
    const el_ = elapsed(t);
    let html = '';
    if (x.badge) html += `<div class="badge">${esc(x.badge)}</div>`;
    if (brand.logo && s.brand !== false && phase !== 'card') {
      const pos = brand.logoPos || 'tr';
      html += `<img class="logo-ov" src="media/brand/logo?v=${esc(brand.logo)}" style="${pos.includes('r') ? 'right:4%' : 'left:4%'};${pos.includes('b') ? 'bottom:4%' : `top:${x.badge && !pos.includes('r') ? 10 : 4}%`}" alt="">`;
    }
    if (!phase) {
      if (x.recap && el_ < 3.2) html += `<div class="recap"><span>${esc(x.recap)}</span></div>`;
      else if (x.hook && el_ < 3 && !x.recap) html += `<div class="hook"><span>${esc(x.hook)}</span></div>`;
      if (s.captions !== false) {
        const gi = groups.findIndex((g, i) => { const nx = groups[i + 1]; const end = Math.min(nx ? nx[0].s : Infinity, g[g.length - 1].e + 0.4); return t >= g[0].s - 0.05 && t < end; });
        if (gi >= 0) {
          const g = groups[gi];
          const style = s.captionStyle || 'karaoke';
          let emoji = '';
          if (s.emojis === true) { const all = g.map((w) => w.w).join(' '); const m = EMOJI.find(([re]) => re.test(all)); if (m) emoji = ' ' + m[1]; }
          const words_ = g.map((w, i) => { const nx = g[i + 1]; const on_ = style !== 'minimal' && t >= w.s && (!nx || t < nx.s); return `<span class="w ${on_ ? 'on' : ''}">${esc(s.upper ? w.w.toUpperCase() : w.w)}</span>`; }).join(' ');
          html += `<div class="cap cap-${style}" style="top:${(s.captionPos ?? 0.7) * 100}%;font-size:calc(${({ minimal: 6.7, comic: 10.2 }[style] || 8.9) * (s.captionSize || 1) * ({ '16:9': 0.41, '1:1': 0.92 }[s.aspect] || 1)}cqw)">${words_}${emoji}</div>`;
        }
      }
    } else if (phase === 'cliff') html += `<div class="cliff"><span>${esc(x.cliff)}</span></div>`;
    else if (phase === 'card') html += `<div class="endcard"><b>${esc(x.card.title)}</b><span>${esc(x.card.line)}</span>${x.card.handle ? `<em>${esc(x.card.handle)}</em>` : ''}<i>➜</i></div>`;
    ov.innerHTML = html;
  }
  function loop() {
    if (state !== 'playing') return;
    const t = v.currentTime;
    const idx = intervals.findIndex(([a, b]) => t >= a - 0.08 && t < b);
    if (idx < 0) {
      const nx = intervals.find(([a]) => a > t);
      if (nx) v.currentTime = nx[0]; else return finish();
    } else if (t >= intervals[idx][1] - 0.04) {
      if (intervals[idx + 1]) v.currentTime = intervals[idx + 1][0]; else return finish();
    }
    drawOverlay(v.currentTime);
    api_.onTime && api_.onTime(v.currentTime);
    raf = requestAnimationFrame(loop);
  }
  function finish() {
    v.pause();
    const x = extras();
    if (!x.cliff && !x.card) return stop();
    state = 'tail';
    el.classList.add('frozen');
    const seq = [];
    if (x.cliff) seq.push(['cliff', 1600]);
    if (x.card) seq.push(['card', 2200]);
    let i = 0;
    const next = () => {
      if (i >= seq.length) return stop();
      drawOverlay(0, seq[i][0]);
      tailTimer = setTimeout(() => { i++; next(); }, seq[i][1]);
    };
    next();
  }
  function stop() {
    state = 'idle'; cancelAnimationFrame(raf); clearTimeout(tailTimer); v.pause();
    el.classList.remove('playing', 'frozen');
    v.currentTime = intervals[0][0];
    drawOverlay(intervals[0][0]);
    api_.onTime && api_.onTime(v.currentTime);
  }
  function play() {
    if (state === 'tail') { clearTimeout(tailTimer); el.classList.remove('frozen'); v.currentTime = intervals[0][0]; }
    const t = v.currentTime;
    if (!intervals.some(([a, b]) => t >= a - 0.1 && t < b - 0.05)) v.currentTime = intervals[0][0];
    state = 'playing'; el.classList.add('playing');
    $$('.phone.playing').forEach((p) => { if (p !== el && p._player) p._player.pause(); });
    v.play().catch(() => {});
    raf = requestAnimationFrame(loop);
  }
  function pause() { if (state === 'playing') { state = 'idle'; v.pause(); cancelAnimationFrame(raf); el.classList.remove('playing'); } else if (state === 'tail') stop(); }
  $('.playbtn', el).addEventListener('click', () => (state === 'idle' ? play() : pause()));
  v.addEventListener('loadedmetadata', () => { if (v.currentTime < 0.1) v.currentTime = intervals[0][0]; });
  const api_ = {
    el, play, pause, stop, update: setup,
    seek(t) { v.currentTime = t; drawOverlay(t); },
    get time() { return v.currentTime; }, get playing() { return state === 'playing'; },
    destroy() { pause(); v.removeAttribute('src'); v.load(); },
  };
  el._player = api_;
  setup(clip);
  return api_;
}

// ---------- vistas ----------
function shell(active, inner) {
  const initials = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  return `<header class="topbar">${brandMark()}
    <nav class="nav"><a href="#/proyectos" class="${active === 'proyectos' ? 'on' : ''}">Proyectos</a><a href="#/calendario" class="${active === 'calendario' ? 'on' : ''}">Calendario</a><a href="#/marca" class="${active === 'marca' ? 'on' : ''}">Kit de marca</a><a href="#/equipo" class="${active === 'equipo' ? 'on' : ''}">Equipo</a></nav>
    <div class="spacer"></div>
    <span class="ai-dot ${me.ai ? 'on' : ''}" title="${me.ai ? 'La IA está conectada' : 'IA sin conectar: se usan reglas automáticas'}"><i></i>${me.ai ? 'IA activa' : 'Modo reglas'}</span>
    <div class="ws-pill"><select id="wsSel">${me.workspaces.map((w) => `<option value="${w.id}" ${w.id === me.workspace ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
    <button class="avatar" id="userBtn" title="${esc(me.user.email)}" style="border:0;cursor:pointer">${esc(initials)}</button>
  </header><main class="page">${inner}</main>`;
}
function bindShell() {
  $('#wsSel')?.addEventListener('change', async (e) => { await api('api/workspaces/switch', { method: 'POST', body: { id: +e.target.value } }); await loadMe(); location.hash = '#/proyectos'; route(); });
  $('#userBtn')?.addEventListener('click', () => modal(`<h3>${esc(me.user.name)}</h3><p class="muted">${esc(me.user.email)}</p><div class="row" style="margin-top:18px"><button class="btn btn-ghost" data-close>Cerrar</button><div class="spacer"></div><button class="btn btn-primary" id="logout">Cerrar sesión</button></div>`, (m, close) => {
    $('#logout', m).onclick = async () => { await api('api/auth/logout', { method: 'POST' }); me = null; close(); if (sock) sock.close(); location.hash = '#/'; route(); };
  }));
}

// ----- portada -----
function viewLanding() {
  app.innerHTML = `<div class="landing">
  <div class="l-nav">${brandMark()}<div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#/entrar">Entrar</a><a class="btn btn-primary btn-sm" href="#/registro">Empieza gratis</a></div>
  <div class="hero">
    <div>
      <div class="free-badge">● 100% gratis · sin marca de agua · sin límites de créditos</div>
      <h1>Tu vídeo largo tiene <em>cien historias</em>. Yussè las encuentra.</h1>
      <p class="lead">Pega un enlace o sube tu vídeo. Yussè Clip escucha, elige los mejores momentos y te los devuelve como clips verticales con subtítulos animados. Y si es una historia larga, te la parte en una serie de 3 capítulos con suspense.</p>
      <div class="row wrap"><a class="btn btn-primary" href="#/registro">Crear mis clips →</a><a class="btn btn-ghost" href="#hilo">Ver el modo Hilo</a></div>
    </div>
    <div class="hero-phones">
      <div class="hero-thread"></div>
      <div class="hp"><div class="b">1/3</div><div class="face"></div><div class="body"></div><div class="c">Y entonces <i>abrió</i> la puerta…</div><div class="end">▶ Parte 2 en mi perfil</div></div>
      <div class="hp" style="--c1:#FFB020"><div class="b">2/3</div><div class="face"></div><div class="body"></div><div class="c">Nadie esperaba <i>eso</i></div><div class="end">▶ Parte 3 en mi perfil</div></div>
      <div class="hp" style="--c1:#3DD6B0"><div class="b">3/3</div><div class="face"></div><div class="body"></div><div class="c">Y así <i>terminó</i> todo</div><div class="end" style="color:var(--amber)">Sígueme para más</div></div>
    </div>
  </div>
  <section class="l cream" style="max-width:none"><div style="max-width:1176px;margin:0 auto">
    <h2>Todo lo que necesitas para publicar en corto</h2><p class="sub">Del vídeo largo al clip listo para TikTok, Reels, Shorts y LinkedIn, sin abrir un editor.</p>
    <div class="feat">
      <div class="f"><div class="ic">🎯</div><h3>Momentos con nota</h3><p class="muted">Cada clip lleva una puntuación de 0 a 99 explicada: gancho, ritmo, valor y cierre. Sabes por qué funciona.</p></div>
      <div class="f"><div class="ic">💬</div><h3>Subtítulos que se mueven</h3><p class="muted">Cinco estilos animados palabra a palabra, con emojis automáticos y los colores de tu marca.</p></div>
      <div class="f"><div class="ic">🧭</div><h3>Encuadre inteligente</h3><p class="muted">Vertical, cuadrado o panorámico. Sigue la cara de quien habla o encaja el plano completo con fondo difuminado.</p></div>
      <div class="f"><div class="ic">✂️</div><h3>Tú tienes la última palabra</h3><p class="muted">Selecciona frases en la transcripción y crea el clip al instante. Une clips, acelera, quita muletillas.</p></div>
      <div class="f"><div class="ic">🕓</div><h3>Nada se pierde</h3><p class="muted">Autoguardado continuo con historial de versiones. Vuelve a cualquier punto con un clic.</p></div>
      <div class="f"><div class="ic">📅</div><h3>Calendario y textos</h3><p class="muted">Planifica qué sale cada día y en qué red, con el texto del post escrito por la IA y listo para copiar.</p></div>
    </div></div></section>
  <section class="l" id="hilo">
    <h2>Modo Hilo narrativo <span style="color:var(--coral)">·</span> series que enganchan</h2>
    <p class="sub">Una anécdota o una explicación de 3 minutos no cabe en un clip. Yussè la parte en tres capítulos y diseña el suspense por ti.</p>
    <div class="steps3">
      <div><h3>Encuentra la historia</h3><p class="muted">Detecta un bloque con planteamiento, nudo y desenlace, o usa el tramo que tú marques.</p></div>
      <div><h3>Corta en el momento justo</h3><p class="muted">Divide en 3 partes y corta justo antes de la revelación, nunca después. Siempre en final de frase.</p></div>
      <div><h3>Suspense y llamada a la acción</h3><p class="muted">Imagen congelada con frase de intriga, tarjeta «▶ Parte 2 en mi perfil», etiqueta 1/3 y un «Antes…» para quien llega tarde.</p></div>
    </div>
  </section>
  <section class="l cream" style="max-width:none"><div style="max-width:1176px;margin:0 auto">
    <h2>Para cualquier vídeo con voz</h2><p class="sub">Clases y cursos, pódcasts, empresa y webinars, eventos y conferencias, directos de videojuegos, entrevistas, sermones, deportes comentados…</p>
    <div class="uses"><span>🎓 Clases</span><span>🎙️ Pódcasts</span><span>💼 Empresa</span><span>🎤 Eventos</span><span>🎮 Videojuegos</span><span>📺 Entrevistas</span><span>🛍️ Producto</span><span>⛪ Charlas</span></div>
  </div></section>
  <section class="l faq" style="max-width:860px">
    <h2>Preguntas frecuentes</h2>
    <details><summary>¿De verdad es gratis?</summary><p>Sí. No hay planes, créditos ni marca de agua, y tus clips no caducan.</p></details>
    <details><summary>¿Qué vídeos puedo usar?</summary><p>Archivos de hasta 4 GB o enlaces públicos (YouTube y similares). Hace falta que haya voz: Yussè trabaja a partir de lo que se dice.</p></details>
    <details><summary>¿En qué idiomas funciona?</summary><p>Transcribe más de 90 idiomas y detecta el idioma solo. La interfaz está en español.</p></details>
    <details><summary>¿Puedo trabajar en equipo?</summary><p>Sí. Crea un espacio, comparte el enlace de invitación y todos veréis los mismos proyectos, marca y calendario.</p></details>
    <details><summary>¿Publica directamente en mis redes?</summary><p>De momento te deja cada clip y su texto listos en el calendario para descargar y publicar en un minuto.</p></details>
  </section>
  <footer class="l">${brandMark()}<p style="margin-top:10px">Hecho para contar mejores historias. © ${new Date().getFullYear()} Yussè Clip</p></footer>
  </div>`;
}

// ----- acceso -----
function viewAuth(mode) {
  const reg = mode === 'registro';
  app.innerHTML = `<div class="auth"><div class="card">${brandMark()}
    <h2>${reg ? 'Crea tu cuenta gratis' : 'Hola de nuevo'}</h2><p class="muted" style="margin:0 0 20px">${reg ? 'En un minuto estarás sacando clips.' : 'Entra para seguir con tus clips.'}</p>
    <div id="err"></div>
    <form id="f">
      ${reg ? '<div class="field"><label>Tu nombre</label><input class="input" name="name" autocomplete="name"></div>' : ''}
      <div class="field"><label>Correo</label><input class="input" name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Contraseña</label><input class="input" name="password" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
      <button class="btn btn-primary" style="width:100%">${reg ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    <p class="muted small" style="text-align:center;margin-top:18px">${reg ? '¿Ya tienes cuenta? <a href="#/entrar">Entra</a>' : '¿Nuevo por aquí? <a href="#/registro">Crea tu cuenta</a>'}</p>
  </div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api(reg ? 'api/auth/register' : 'api/auth/login', { method: 'POST', body: fd });
      await loadMe();
      const back = sessionStorage.getItem('yc_after');
      sessionStorage.removeItem('yc_after');
      location.hash = back || '#/proyectos';
    } catch (err) { $('#err').innerHTML = `<div class="err-msg">${esc(err.message)}</div>`; }
  };
}

// ----- proyectos -----
function projectCard(p) {
  const st = p.status === 'ready' ? `<span class="tag mint">${p.mode === 'thread' ? `${p.threads} hilo${p.threads === 1 ? '' : 's'}` : `${p.clips} clips`}</span>`
    : p.status === 'error' ? '<span class="tag coral">Error</span>' : '<span class="tag amber">Procesando</span>';
  return `<a class="pcard" href="#/p/${p.id}" data-pid="${p.id}">
    <div class="thumb" style="background-image:url(media/p/${p.id}/thumb.jpg)"><span class="tag dark">${p.mode === 'thread' ? '🧵 Hilo narrativo' : '✂️ Clips'}</span></div>
    <div class="body"><h3>${esc(p.title)}</h3>
      <div class="row small muted">${st}<span>${p.duration ? fmtLong(p.duration) : ''}</span></div>
      ${p.status !== 'ready' && p.status !== 'error' ? `<div class="small muted pstep">${esc(p.step || 'En cola')}</div><div class="bar"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div>` : ''}
      ${p.status === 'error' ? `<div class="small" style="color:#ff9b84">${esc(p.error || '')}</div>` : ''}
    </div></a>`;
}

async function viewProjects() {
  app.innerHTML = shell('proyectos', `
    <div class="composer">
      <h2 style="font-size:26px;margin-bottom:14px">¿Qué historia vamos a recortar hoy?</h2>
      <div class="drop" id="drop">
        <span style="font-size:20px">🔗</span>
        <input class="url" id="url" placeholder="Pega un enlace de YouTube, Vimeo… o suelta aquí tu vídeo">
        <label class="btn btn-soft btn-sm" style="cursor:pointer">Subir archivo<input type="file" id="file" accept="video/*,.mkv,.mov" hidden></label>
        <button class="btn btn-primary" id="go">Crear clips</button>
      </div>
      <div id="fileInfo" style="margin-top:10px"></div>
      <div class="mode-tabs">
        <button class="mode-tab on" data-mode="clips"><span class="ic">✂️</span><div><b>Clips</b><span>Los mejores momentos sueltos, con nota y subtítulos.</span></div></button>
        <button class="mode-tab" data-mode="thread"><span class="ic">🧵</span><div><b>Hilo narrativo</b><span>Una historia larga en 3 partes con suspense y «sigue en mi perfil».</span></div></button>
      </div>
      <details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Opciones avanzadas</summary>
      <div class="opts">
        <div class="field" id="lenField"><label>Duración de cada clip</label><select class="input" id="len">${Object.entries(LENGTHS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field hidden" id="tlenField"><label>Duración total del hilo</label><select class="input" id="tlen"><option value="120">~2 min</option><option value="180" selected>~3 min</option><option value="240">~4 min</option></select></div>
        <div class="field"><label>Solo este tramo (opcional)</label><div class="row"><input class="input" id="from" placeholder="desde 0:00"><input class="input" id="to" placeholder="hasta 12:30"></div></div>
        <div class="field"><label>Idioma del vídeo</label><select class="input" id="lang"><option value="auto">Detectar solo</option><option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option><option value="fr">Francés</option><option value="it">Italiano</option><option value="de">Alemán</option></select></div>
        <div class="field" style="grid-column:1/-1"><label>¿Buscas algo concreto? (opcional)</label><input class="input" id="prompt" placeholder="Ej.: los momentos más graciosos · cuando explica el precio · las jugadas de la final"></div>
        <div class="field"><label>Usar IA para elegir</label><label class="row small"><span class="switch"><input type="checkbox" id="useAi" ${me.ai ? 'checked' : 'disabled'}><span></span></span>${me.ai ? 'Activada' : 'No conectada (se usan reglas)'}</label></div>
      </div></details>
    </div>
    <div class="page-head"><h1>Tus proyectos</h1><div class="spacer"></div><span class="muted small" id="qinfo"></span></div>
    <div id="list"><div class="empty">Cargando…</div></div>`);
  bindShell();
  let mode = 'clips', file = null;
  $$('.mode-tab').forEach((b) => b.onclick = () => {
    mode = b.dataset.mode; $$('.mode-tab').forEach((x) => x.classList.toggle('on', x === b));
    $('#go').textContent = mode === 'thread' ? 'Crear hilo' : 'Crear clips';
    $('#lenField').classList.toggle('hidden', mode === 'thread'); $('#tlenField').classList.toggle('hidden', mode !== 'thread');
  });
  const setFile = (f) => { file = f; $('#fileInfo').innerHTML = f ? `<span class="file-chip">🎬 ${esc(f.name)} · ${(f.size / 1048576).toFixed(0)} MB <button class="btn btn-sm btn-ghost" id="rmf" style="padding:2px 8px">✕</button></span>` : ''; if (f) { $('#url').value = ''; $('#rmf').onclick = () => setFile(null); } };
  $('#file').onchange = (e) => setFile(e.target.files[0]);
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) setFile(f); });
  $('#go').onclick = () => {
    const url = $('#url').value.trim();
    if (!file && !url) return toast('Pega un enlace o elige un archivo', true);
    const fd = new FormData();
    if (file) fd.append('file', file); else fd.append('url', url);
    fd.append('mode', mode);
    fd.append('options', JSON.stringify({ length: $('#len').value, threadLength: +$('#tlen').value, from: parseT($('#from').value), to: parseT($('#to').value), language: $('#lang').value, prompt: $('#prompt').value, ai: $('#useAi').checked }));
    const btn = $('#go'); btn.disabled = true;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/projects');
    xhr.upload.onprogress = (e) => { if (file && e.lengthComputable) btn.textContent = `Subiendo ${Math.round(e.loaded / e.total * 100)}%`; };
    xhr.onload = () => {
      btn.disabled = false; btn.textContent = mode === 'thread' ? 'Crear hilo' : 'Crear clips';
      let j = {}; try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status !== 200) return toast(j.error || 'No se pudo crear el proyecto', true);
      location.hash = `#/p/${j.id}`;
    };
    xhr.onerror = () => { btn.disabled = false; toast('Se cortó la subida. Revisa tu conexión.', true); };
    xhr.send(fd);
  };
  const load = async () => {
    const list = await api('api/projects');
    $('#list').innerHTML = list.length ? `<div class="grid">${list.map(projectCard).join('')}</div>`
      : `<div class="empty"><div class="big">🎬</div><h3 style="margin:10px 0 6px;color:var(--cream)">Aún no hay proyectos</h3><p>Pega un enlace arriba o suelta un vídeo para empezar.</p></div>`;
  };
  await load();
  onView((m) => {
    if (m.type === 'project') {
      const card = $(`[data-pid="${m.project.id}"]`);
      if (!card || m.project.status === 'ready' || m.project.status === 'error') return load();
      const s = $('.pstep', card), b = $('.bar i', card);
      if (s) s.textContent = m.project.step; if (b) b.style.width = Math.round(m.project.progress * 100) + '%';
    }
  });
}

// ----- proyecto -----
const STEPS = ['Descargando el vídeo', 'Preparando la vista previa', 'Escuchando y transcribiendo', 'Eligiendo los mejores momentos'];
function liveSteps(p) {
  const cur = p.step || 'En cola';
  let idx = STEPS.findIndex((s) => cur.includes(s.split(' ').slice(-2).join(' ')) || cur === s);
  if (/IA|momentos/.test(cur)) idx = 3;
  const steps = p.source_type === 'url' ? STEPS : STEPS.slice(1);
  if (p.source_type !== 'url') idx = Math.max(-1, idx - 1);
  return `<div class="live"><h2>${p.mode === 'thread' ? 'Tejiendo tu hilo…' : 'Buscando tus mejores momentos…'}</h2>
    <p class="muted">Puedes cerrar esta pestaña: seguimos trabajando y te lo guardamos aquí.</p>
    <div class="bar" style="margin-top:20px"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div>
    <div class="steps">${steps.map((s, i) => `<div class="stp ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="dot">${i < idx ? '✓' : ''}</span>${i === idx && /IA/.test(cur) ? esc(cur) : s}</div>`).join('')}</div>
    <p class="muted small" id="qpos">${cur === 'En cola' || !p.step ? 'En cola, empezamos enseguida…' : ''}</p></div>`;
}

async function viewProject(id, tab) {
  let p = await api(`api/projects/${id}`);
  let tr = null;
  const players = [];
  const selected = new Set();
  app.innerHTML = shell('proyectos', `<div id="pv"></div>`);
  bindShell();
  const pv = $('#pv');
  const killPlayers = () => { players.splice(0).forEach((x) => x.destroy()); };
  cleanup.push(() => killPlayers());

  async function render() {
    killPlayers();
    if (p.status !== 'ready') {
      pv.innerHTML = `<div class="page-head"><div><a href="#/proyectos" class="muted small">← Proyectos</a><h1 style="margin-top:6px">${esc(p.title)}</h1></div></div>` +
        (p.status === 'error' ? `<div class="live"><div class="big" style="font-size:44px">😕</div><h2>No hemos podido con este vídeo</h2><p class="muted">${esc(p.error)}</p><div class="row" style="justify-content:center;margin-top:20px"><button class="btn btn-primary" id="retry">Reintentar</button><button class="btn btn-ghost" id="del">Borrar proyecto</button></div></div>` : liveSteps(p));
      $('#retry') && ($('#retry').onclick = async () => { await api(`api/projects/${id}/retry`, { method: 'POST' }); p.status = 'queued'; p.step = 'En cola'; render(); });
      $('#del') && ($('#del').onclick = delProject);
      return;
    }
    if (!tr) tr = await api(`api/projects/${id}/transcript`);
    const nThreads = p.threads.length, nClips = p.clips.filter((c) => !c.thread_id).length;
    tab = tab || (p.mode === 'thread' && nThreads ? 'hilos' : 'clips');
    pv.innerHTML = `<div class="page-head"><div style="min-width:0;flex:1"><a href="#/proyectos" class="muted small">← Proyectos</a>
      <h1 style="margin-top:6px" contenteditable="true" spellcheck="false" id="ptitle">${esc(p.title)}</h1>
      <div class="row small muted" style="margin-top:8px">${fmtLong(p.duration)} · ${p.language ? p.language.toUpperCase() : ''} · ${p.ai_used ? '<span class="tag mint">Elegido con IA</span>' : '<span class="tag">Elegido con reglas</span>'}</div></div>
      <button class="btn btn-ghost btn-sm" id="del">Borrar</button></div>
      <div class="tabs"><button data-t="clips" class="${tab === 'clips' ? 'on' : ''}">✂️ Clips (${nClips})</button><button data-t="hilos" class="${tab === 'hilos' ? 'on' : ''}">🧵 Hilos (${nThreads})</button><button data-t="texto" class="${tab === 'texto' ? 'on' : ''}">📝 Transcripción · clip a mano</button></div>
      <div id="tabc"></div>`;
    $$('.tabs button', pv).forEach((b) => b.onclick = () => { tab = b.dataset.t; history.replaceState(null, '', `#/p/${id}/${tab}`); render(); });
    $('#del').onclick = delProject;
    $('#ptitle').addEventListener('blur', (e) => api(`api/projects/${id}`, { method: 'PATCH', body: { title: e.target.textContent.trim() } }));
    if (tab === 'clips') renderClips(); else if (tab === 'hilos') renderThreads(); else renderTranscript();
  }
  async function delProject() {
    if (!confirm('¿Borrar este proyecto y todos sus clips?')) return;
    await api(`api/projects/${id}`, { method: 'DELETE' }); location.hash = '#/proyectos';
  }
  async function reload() { p = await api(`api/projects/${id}`); render(); }

  function renderClips() {
    const c = $('#tabc');
    let sort = sessionStorage.getItem('yc_sort') || 'score';
    const clips = p.clips.filter((x) => !x.thread_id).sort((a, b) => sort === 'score' ? b.score - a.score : sort === 'time' ? a.ranges[0][0] - b.ranges[0][0] : rangesDur(a.ranges) - rangesDur(b.ranges));
    c.innerHTML = `<div class="toolbar">
      <select class="input" id="sort" style="width:auto"><option value="score">Mejor nota primero</option><option value="time">Orden del vídeo</option><option value="len">Más cortos primero</option></select>
      <button class="btn btn-soft btn-sm" id="more">✨ Buscar más momentos</button>
      <div class="spacer"></div>
      <span class="muted small" id="selInfo"></span>
      <button class="btn btn-soft btn-sm" id="merge" disabled>🔗 Unir seleccionados</button>
      <button class="btn btn-amber btn-sm" id="dlall">⬇ Descargar todos</button></div>
      ${clips.length ? '<div class="clips" id="clips"></div>' : '<div class="empty"><div class="big">✂️</div><p>No hay clips sueltos todavía. Pulsa «Buscar más momentos» o crea uno desde la transcripción.</p></div>'}`;
    $('#sort').value = sort;
    $('#sort').onchange = (e) => { sessionStorage.setItem('yc_sort', e.target.value); renderClips(); };
    const grid = $('#clips');
    clips.forEach((cl) => {
      const card = document.createElement('div');
      card.className = 'ccard' + (selected.has(cl.id) ? ' sel' : '');
      const d = cl.score_detail || {};
      card.innerHTML = `<button class="pick" title="Seleccionar para unir o descargar">${selected.has(cl.id) ? '✓' : ''}</button><div class="phone-wrap"></div>
        <div class="info">
          <div class="row"><div class="score-ring" style="--v:${cl.score};--sc:${scoreColor(cl.score)}"><b>${cl.score}</b></div><div style="min-width:0"><h4>${esc(cl.title)}</h4><div class="muted small">${fmt(cl.ranges[0][0])} · ${fmt(rangesDur(cl.ranges))} ${cl.kind === 'manual' ? '· <span class="tag">a mano</span>' : cl.kind === 'merge' ? '· <span class="tag">unión</span>' : ''}</div></div></div>
          <div class="breakdown">${['gancho', 'ritmo', 'valor', 'cierre'].map((k) => `<span>${k[0].toUpperCase() + k.slice(1)}</span><div class="bar"><i style="width:${d[k] || 0}%"></i></div><span>${d[k] || '–'}</span>`).join('')}</div>
          ${d.reason ? `<div class="why">“${esc(d.reason)}”</div>` : ''}
          <div class="actions"><a class="btn btn-primary btn-sm" href="#/clip/${cl.id}">Editar</a><button class="btn btn-soft btn-sm dl" data-id="${cl.id}">⬇ Descargar</button><button class="btn btn-ghost btn-sm sch" title="Planificar">📅</button></div>
        </div>`;
      grid.appendChild(card);
      const pl = Player({ project: p, clip: cl, words: tr.words });
      players.push(pl);
      $('.phone-wrap', card).appendChild(pl.el);
      $('.pick', card).onclick = () => { selected.has(cl.id) ? selected.delete(cl.id) : selected.add(cl.id); card.classList.toggle('sel'); $('.pick', card).textContent = selected.has(cl.id) ? '✓' : ''; updSel(); };
      $('.dl', card).onclick = (e) => startDownload(cl.id, e.currentTarget);
      $('.sch', card).onclick = () => scheduleModal(cl);
    });
    const updSel = () => { $('#selInfo').textContent = selected.size ? `${selected.size} seleccionado${selected.size > 1 ? 's' : ''}` : ''; $('#merge').disabled = selected.size < 2; };
    updSel();
    $('#merge').onclick = async () => {
      const ids = clips.filter((x) => selected.has(x.id)).sort((a, b) => a.ranges[0][0] - b.ranges[0][0]).map((x) => x.id);
      const r = await api(`api/projects/${id}/merge`, { method: 'POST', body: { clipIds: ids } });
      selected.clear(); toast('Clips unidos ✅'); location.hash = `#/clip/${r.id}`;
    };
    $('#dlall').onclick = async () => {
      const ids = selected.size ? [...selected] : clips.map((x) => x.id);
      await api(`api/projects/${id}/render-all`, { method: 'POST', body: { clipIds: ids } });
      bulkProgress(ids);
    };
    $('#more').onclick = () => moreModal('clips');
  }

  function bulkProgress(ids) {
    const done = new Set();
    let off;
    const close = modal(`<h3>Montando ${ids.length} clips</h3><p class="muted">Se montan en tu servidor con subtítulos y marca. Te avisamos al terminar.</p><div class="bar" style="margin:18px 0"><i id="bp" style="width:0%"></i></div><p class="small muted" id="bpt">0 de ${ids.length}</p><div class="row"><div class="spacer"></div><button class="btn btn-ghost" data-close>Seguir en segundo plano</button></div>`);
    const partial = {};
    const upd = () => {
      const v = ids.reduce((a, i) => a + (done.has(i) ? 1 : partial[i] || 0), 0) / ids.length;
      const bp = $('#bp'); if (bp) bp.style.width = Math.round(v * 100) + '%';
      const bt = $('#bpt'); if (bt) bt.textContent = `${done.size} de ${ids.length}`;
      if (done.size === ids.length) { off(); close(); download(`media/p/${id}/zip?ids=${ids.join(',')}`); toast('Tus clips están listos ✅'); }
    };
    off = on((m) => { if (m.type === 'render' && ids.includes(m.clipId)) { if (m.status === 'done') done.add(m.clipId); else partial[m.clipId] = m.progress || 0; upd(); } });
    cleanup.push(off);
  }

  function moreModal(kind) {
    modal(`<h3>${kind === 'clips' ? 'Buscar más momentos' : 'Nuevo hilo'}</h3>
      <div class="field"><label>¿Qué buscas? (opcional)</label><input class="input" id="mp" placeholder="Ej.: cuando habla de precios"></div>
      <div class="opts" style="margin:0"><div class="field"><label>Duración</label><select class="input" id="ml">${Object.entries(LENGTHS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label>Tramo</label><div class="row"><input class="input" id="mf" placeholder="desde"><input class="input" id="mt" placeholder="hasta"></div></div></div>
      <div class="row"><button class="btn btn-ghost" data-close>Cancelar</button><div class="spacer"></div><button class="btn btn-primary" id="mgo">Buscar</button></div>`, (m, close) => {
      $('#mgo', m).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Buscando…';
        try {
          const r = await api(`api/projects/${id}/analyze`, { method: 'POST', body: { mode: 'clips', options: { prompt: $('#mp', m).value, length: $('#ml', m).value, from: parseT($('#mf', m).value), to: parseT($('#mt', m).value) } } });
          close(); toast(`${r.added} clips nuevos ✅`); reload();
        } catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = 'Buscar'; }
      };
    });
  }

  function renderThreads() {
    const c = $('#tabc');
    c.innerHTML = `<div class="toolbar"><p class="muted" style="margin:0">Cada hilo es una serie de 3 partes. Ajusta los cortes y los textos de suspense; todo se guarda solo.</p><div class="spacer"></div><button class="btn btn-soft btn-sm" id="autoT">✨ Buscar otro hilo</button><a class="btn btn-ghost btn-sm" href="#/p/${id}/texto">Marcar el tramo a mano</a></div><div id="thl"></div>`;
    $('#autoT').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Buscando…';
      try { const r = await api(`api/projects/${id}/analyze`, { method: 'POST', body: { mode: 'thread', options: { threadLength: p.options.threadLength || 180 } } }); toast(r.added ? 'Nuevo hilo listo ✅' : 'No encontré otra historia distinta'); reload(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = '✨ Buscar otro hilo'; }
    };
    const box = $('#thl');
    if (!p.threads.length) { box.innerHTML = '<div class="empty"><div class="big">🧵</div><p>Aún no hay hilos. Pulsa «Buscar otro hilo» o marca un tramo de unos 3 minutos en la transcripción.</p></div>'; return; }
    p.threads.forEach((t) => {
      const parts = p.clips.filter((x) => x.thread_id === t.id).sort((a, b) => a.part_index - b.part_index);
      if (parts.length !== 3) return;
      const el = document.createElement('div');
      el.className = 'thread';
      el.innerHTML = `<div class="thread-head"><div style="flex:1;min-width:0"><span class="tag coral">🧵 Hilo · ${fmt(rangesDur(parts.flatMap((x) => x.ranges)))} en total</span><h3 style="margin-top:8px" contenteditable="true" spellcheck="false" class="ttitle">${esc(t.title)}</h3>${t.summary ? `<p class="muted small" style="margin:6px 0 0">${esc(t.summary)}</p>` : ''}</div>
        <div class="row wrap"><button class="btn btn-amber btn-sm dl3">⬇ Descargar las 3 partes</button><button class="btn btn-soft btn-sm sch3">📅 Planificar serie</button><button class="btn btn-ghost btn-sm delt">Borrar</button></div></div>
        <div class="carousel"></div>`;
      box.appendChild(el);
      const car = $('.carousel', el);
      parts.forEach((cl, i) => {
        const part = document.createElement('div');
        part.className = 'part';
        part.innerHTML = `<div class="row"><span class="tag ${['coral', 'amber', 'mint'][i]}">Parte ${i + 1}</span><span class="muted small">${fmt(cl.ranges[0][0])} · ${fmt(rangesDur(cl.ranges))}</span><div class="spacer"></div><a class="btn btn-ghost btn-sm" href="#/clip/${cl.id}">Editar</a></div><div class="pw"></div>
          ${i > 0 ? `<div><div class="lbl">Resumen inicial («Antes…»)</div><textarea class="input" data-k="recap">${esc(cl.settings.recap || '')}</textarea></div>` : ''}
          ${i < 2 ? `<div><div class="lbl">Suspense final</div><textarea class="input" data-k="cliffhanger">${esc(cl.settings.cliffhanger || '')}</textarea></div>
          <div><div class="lbl">Llamada a la acción</div><input class="input" data-k="ctaTitle" value="${esc(cl.settings.ctaTitle || `▶ Parte ${i + 2} en mi perfil`)}"></div>` : `<div><div class="lbl">Cierre de la serie</div><input class="input" data-k="ctaTitle" value="${esc(cl.settings.ctaTitle || 'Fin de la historia')}"></div>`}`;
        const pl = Player({ project: p, clip: cl, words: tr.words });
        players.push(pl);
        $('.pw', part).appendChild(pl.el);
        const save = debounce(async (k, v) => {
          const upd = { [k]: v }; if (k === 'cliffhanger') upd.cliffhangerEdited = true;
          const r = await api(`api/clips/${cl.id}`, { method: 'PATCH', body: { settings: upd } });
          Object.assign(cl, r); pl.update(cl);
        }, 500);
        $$('[data-k]', part).forEach((inp) => inp.addEventListener('input', () => save(inp.dataset.k, inp.value)));
        car.appendChild(part);
        if (i < 2) {
          const con = document.createElement('div');
          con.className = 'connector';
          con.innerHTML = `<span class="arrow">➜</span><span>Corte</span><div class="row" style="gap:4px"><button class="btn btn-soft btn-icon btn-sm" data-d="-1" title="Cortar una frase antes">◀</button><button class="btn btn-soft btn-icon btn-sm" data-d="1" title="Cortar una frase después">▶</button></div>`;
          $$('button', con).forEach((b) => b.onclick = async () => {
            try { await api(`api/threads/${t.id}/cut`, { method: 'POST', body: { cut: i, delta: +b.dataset.d } }); reload(); } catch (err) { toast(err.message, true); }
          });
          car.appendChild(con);
        }
      });
      $('.ttitle', el).addEventListener('blur', (e) => api(`api/threads/${t.id}`, { method: 'PATCH', body: { title: e.target.textContent.trim() } }));
      $('.delt', el).onclick = async () => { if (!confirm('¿Borrar este hilo y sus 3 partes?')) return; await api(`api/threads/${t.id}`, { method: 'DELETE' }); reload(); };
      $('.dl3', el).onclick = async () => { const ids = parts.map((x) => x.id); await api(`api/projects/${id}/render-all`, { method: 'POST', body: { clipIds: ids } }); bulkProgress(ids); };
      $('.sch3', el).onclick = () => scheduleThreadModal(t);
    });
  }

  function renderTranscript() {
    const c = $('#tabc');
    const { words, sentences } = tr;
    c.innerHTML = `<p class="muted" style="margin-top:0">Haz clic en la primera palabra y <b>Mayús + clic</b> (o clic) en la última para seleccionar un tramo. Doble clic en una palabra para corregirla.</p>
      <div class="row" style="align-items:flex-start;gap:20px;flex-wrap:wrap"><div class="transcript" id="tx" style="flex:1;min-width:300px"></div><div style="width:260px" id="mini"></div></div>
      <div class="selbar hidden" id="sb"><b id="sbl"></b><div class="spacer"></div><button class="btn btn-ghost btn-sm" id="sbx">Quitar selección</button><button class="btn btn-soft btn-sm" id="sbt" style="background:var(--ink);color:var(--cream)">🧵 Hacer hilo de 3 partes</button><button class="btn btn-primary btn-sm" id="sbc">✂️ Crear clip</button></div>`;
    const tx = $('#tx');
    tx.innerHTML = sentences.map((s) => `<div class="sent"><span class="t" data-t="${s.s}">${fmt(s.s)}</span>${words.slice(s.i0, s.i1 + 1).map((w, k) => `<span class="wd" data-i="${s.i0 + k}">${esc(w.w)}</span>`).join(' ')}</div>`).join('');
    let a = null, b = null;
    const mini = { id: 0, ranges: [[0, Math.min(p.duration, 30)]], settings: { aspect: '9:16', reframe: 'face', captionStyle: 'karaoke', cropX: null, showHook: false }, hook: '' };
    const pl = Player({ project: p, clip: mini, words });
    players.push(pl);
    $('#mini').appendChild(pl.el);
    const paint = () => {
      const lo = Math.min(a ?? -1, b ?? a ?? -1), hi = Math.max(a ?? -1, b ?? a ?? -1);
      $$('.wd', tx).forEach((el) => { const i = +el.dataset.i; el.classList.toggle('sel', a != null && i >= lo && i <= hi); });
      if (a == null) { $('#sb').classList.add('hidden'); return; }
      const s = words[lo].s, e = words[hi].e;
      $('#sb').classList.remove('hidden');
      $('#sbl').textContent = `${fmt(s)} → ${fmt(e)} · ${fmt(e - s)}`;
      $('#sbt').disabled = e - s < 45;
      $('#sbt').title = e - s < 45 ? 'Selecciona al menos 45 s' : '';
      pl.update({ ...mini, ranges: [[s, e]] });
    };
    tx.addEventListener('click', (e) => {
      const t = e.target.closest('.t');
      if (t) { pl.seek(+t.dataset.t); return; }
      const w = e.target.closest('.wd'); if (!w) return;
      const i = +w.dataset.i;
      if (a == null || (!e.shiftKey && b != null)) { a = i; b = null; } else b = i;
      paint();
    });
    tx.addEventListener('dblclick', async (e) => {
      const w = e.target.closest('.wd'); if (!w) return;
      const i = +w.dataset.i;
      const nv = prompt('Corregir palabra', words[i].w);
      if (nv == null || !nv.trim()) return;
      words[i].w = nv.trim(); w.textContent = nv.trim();
      await api(`api/projects/${id}/transcript/words`, { method: 'PUT', body: { edits: [{ i, w: nv.trim() }] } });
      toast('Corregido ✅');
    });
    $('#sbx').onclick = () => { a = b = null; paint(); };
    const range = () => { const lo = Math.min(a, b ?? a), hi = Math.max(a, b ?? a); return [words[lo].s, words[hi].e]; };
    $('#sbc').onclick = async () => { const r = await api(`api/projects/${id}/clips`, { method: 'POST', body: { ranges: [range()] } }); toast('Clip creado ✅'); location.hash = `#/clip/${r.id}`; };
    $('#sbt').onclick = async (e) => {
      const [s, en] = range(); e.target.disabled = true; e.target.textContent = 'Diseñando el suspense…';
      try { await api(`api/projects/${id}/threads`, { method: 'POST', body: { from: s, to: en } }); toast('Hilo creado ✅'); tab = 'hilos'; history.replaceState(null, '', `#/p/${id}/hilos`); await reload(); }
      catch (err) { toast(err.message, true); e.target.disabled = false; e.target.textContent = '🧵 Hacer hilo de 3 partes'; }
    };
    pl.onTime = (t) => { const cur = $('.wd.cur', tx); if (cur) cur.classList.remove('cur'); if (!pl.playing) return; const i = words.findIndex((w) => t >= w.s && t < w.e + 0.15); const el = i >= 0 && $(`.wd[data-i="${i}"]`, tx); if (el) el.classList.add('cur'); };
  }

  function scheduleThreadModal(t) {
    const d = new Date(Date.now() + 86400000); d.setHours(19, 0, 0, 0);
    modal(`<h3>Planificar la serie</h3><p class="muted">Las 3 partes se reparten en el calendario en orden, con el texto de cada una.</p>
      <div class="field"><label>Primera parte</label><input class="input" type="datetime-local" id="sd" value="${toLocal(d)}"></div>
      <div class="field"><label>Separación entre partes</label><select class="input" id="sg"><option value="3">3 horas</option><option value="12">12 horas</option><option value="24" selected>1 día</option><option value="48">2 días</option></select></div>
      <div class="field"><label>Redes</label><div class="chips" id="sn">${Object.entries(NETS).map(([k, v]) => `<button class="chip ${k === 'tiktok' ? 'on' : ''}" data-n="${k}">${v}</button>`).join('')}</div></div>
      <div class="row"><button class="btn btn-ghost" data-close>Cancelar</button><div class="spacer"></div><button class="btn btn-primary" id="sgo">Planificar</button></div>`, (m, close) => {
      $$('.chip', m).forEach((c) => c.onclick = () => c.classList.toggle('on'));
      $('#sgo', m).onclick = async () => {
        const nets = $$('.chip.on', m).map((c) => c.dataset.n);
        if (!nets.length) return toast('Elige al menos una red', true);
        await api(`api/threads/${t.id}/schedule`, { method: 'POST', body: { start: Math.floor(new Date($('#sd', m).value).getTime() / 1000), gapHours: +$('#sg', m).value, networks: nets } });
        close(); toast('Serie planificada ✅ Mírala en el calendario');
      };
    });
  }

  onView((m) => {
    if (m.type === 'project' && m.project.id === +id) {
      const was = p.status;
      Object.assign(p, m.project);
      if (m.project.status === 'ready' && was !== 'ready') reload();
      else if (p.status !== 'ready') render();
    }
    if (m.type === 'queue' && m.ref.project === +id && $('#qpos')) $('#qpos').textContent = m.position > 1 ? `Hay ${m.position - 1} trabajo${m.position > 2 ? 's' : ''} antes del tuyo…` : 'Empezamos enseguida…';
    if (m.type === 'render') {
      const b = $(`.dl[data-id="${m.clipId}"]`);
      if (b) b.textContent = m.status === 'done' ? '⬇ Descargar' : m.status === 'error' ? '⬇ Reintentar' : `Montando ${Math.round((m.progress || 0) * 100)}%`;
    }
  });
  render();
}

function toLocal(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }

async function startDownload(clipId, btn) {
  pendingDownloads.add(clipId);
  if (btn) btn.textContent = 'Preparando…';
  try { await api(`api/clips/${clipId}/render`, { method: 'POST' }); } catch (e) { pendingDownloads.delete(clipId); toast(e.message, true); }
}

function scheduleModal(cl) {
  const d = new Date(Date.now() + 86400000); d.setHours(19, 0, 0, 0);
  modal(`<h3>Planificar publicación</h3><p class="muted small">${esc(cl.title)}</p>
    <div class="field"><label>Red</label><select class="input" id="pn">${Object.entries(NETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field"><label>Fecha y hora</label><input class="input" type="datetime-local" id="pd" value="${toLocal(d)}"></div>
    <div class="field"><label>Texto del post</label><textarea class="input" id="pt" placeholder="Escribe o genera el texto…">${esc(cl.post_text || '')}</textarea><button class="btn btn-soft btn-sm" id="pg" style="align-self:flex-start">✨ Generar texto</button></div>
    <div class="row"><button class="btn btn-ghost" data-close>Cancelar</button><div class="spacer"></div><button class="btn btn-primary" id="pgo">Añadir al calendario</button></div>`, (m, close) => {
    $('#pg', m).onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Escribiendo…'; try { const r = await api(`api/clips/${cl.id}/post-text`, { method: 'POST', body: { network: $('#pn', m).value } }); $('#pt', m).value = r.text; } catch (err) { toast(err.message, true); } e.target.disabled = false; e.target.textContent = '✨ Generar texto'; };
    $('#pgo', m).onclick = async () => {
      await api('api/posts', { method: 'POST', body: { clip_id: cl.id, network: $('#pn', m).value, at: Math.floor(new Date($('#pd', m).value).getTime() / 1000), text: $('#pt', m).value } });
      close(); toast('Añadido al calendario ✅');
    };
  });
}

// ----- editor de clip -----
async function viewClip(id) {
  let clip = await api(`api/clips/${id}`);
  const p = await api(`api/projects/${clip.project_id}`);
  const tr = await api(`api/projects/${clip.project_id}/transcript`);
  const words = tr.words;
  app.innerHTML = shell('proyectos', `<div class="page-head"><div style="flex:1;min-width:0"><a href="#/p/${p.id}${clip.thread_id ? '/hilos' : ''}" class="muted small">← ${esc(p.title)}</a>
      <h1 style="margin-top:6px;font-size:28px" contenteditable="true" spellcheck="false" id="ctitle">${esc(clip.title)}</h1></div>
      <span class="saved" id="saved"></span>
      <button class="btn btn-ghost btn-sm" id="dup">Duplicar</button>
      <button class="btn btn-primary" id="dl">⬇ Descargar MP4</button></div>
    <div class="editor">
      <div class="panel"><div class="row" style="margin-bottom:10px"><b>Transcripción</b><div class="spacer"></div><span class="muted small">Clic en una palabra para recortar</span></div><div class="tx" id="tx"></div></div>
      <div class="stage"><div id="ph"></div>
        <div class="ctrls"><button class="btn btn-soft btn-icon" id="back" title="Al inicio">⏮</button><button class="btn btn-primary btn-icon" id="pp" style="width:48px;height:48px">▶</button><span class="muted small mono" id="tm">0:00</span></div>
        <div class="wave" id="wave"><canvas></canvas><div class="ph"></div></div>
        <div class="row small muted"><span id="win"></span><div class="spacer"></div><span>Arrastra los bordes naranjas para ajustar</span></div>
      </div>
      <div class="panel"><div class="ptabs">${['Subtítulos', 'Encuadre', 'Ajustes', 'Textos', 'Publicar', 'Historial'].map((t, i) => `<button data-pt="${i}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div><div id="pc"></div></div>
    </div>`);
  bindShell();
  const pl = Player({ project: p, clip, words });
  $('#ph').appendChild(pl.el);
  cleanup.push(() => pl.destroy());
  let ptab = 0;

  // guardado automatico
  let pending = {};
  const flush = debounce(async () => {
    const body = pending; pending = {};
    try { clip = { ...clip, ...(await api(`api/clips/${id}`, { method: 'PATCH', body })) }; if ($('#saved')) $('#saved').textContent = 'Guardado ✓'; setTimeout(() => { if ($('#saved')) $('#saved').textContent = ''; }, 1600); }
    catch (e) { toast(e.message, true); }
  }, 600);
  function change(upd) {
    if (upd.settings) { clip.settings = { ...clip.settings, ...upd.settings }; pending.settings = { ...(pending.settings || {}), ...upd.settings }; }
    for (const k of ['title', 'hook', 'ranges', 'post_text']) if (k in upd) { clip[k] = upd[k]; pending[k] = upd[k]; }
    if ($('#saved')) $('#saved').textContent = 'Guardando…';
    pl.update(clip);
    if (upd.ranges || upd.settings?.removeFillers !== undefined) { drawWave(); paintTx(); }
    flush();
  }
  $('#ctitle').addEventListener('input', (e) => change({ title: e.target.textContent.trim() }));

  // transcripcion del editor
  const winS = () => Math.max(0, clip.ranges[0][0] - 25), winE = () => Math.min(p.duration, clip.ranges[clip.ranges.length - 1][1] + 25);
  function paintTx() {
    const s = winS(), e = winE();
    const idx = words.map((w, i) => i).filter((i) => words[i].s >= s && words[i].e <= e);
    $('#tx').innerHTML = idx.map((i) => { const w = words[i]; const inside = clip.ranges.some(([a, b]) => w.s >= a - 0.01 && w.e <= b + 0.01); return `<span class="wd ${inside ? 'in' : 'out'} ${inside && clip.settings.removeFillers && isFiller(w.w) ? 'filler' : ''}" data-i="${i}">${esc(w.w)}</span>`; }).join(' ');
  }
  paintTx();
  $('#tx').addEventListener('click', (e) => {
    const w = e.target.closest('.wd'); if (!w) return;
    const i = +w.dataset.i;
    $('.wmenu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'wmenu card';
    menu.style.cssText = 'position:absolute;z-index:50;padding:6px;display:flex;flex-direction:column;gap:4px;border-radius:12px';
    menu.innerHTML = `<button class="btn btn-soft btn-sm" data-a="s">⇤ Empezar aquí</button><button class="btn btn-soft btn-sm" data-a="e">Terminar aquí ⇥</button><button class="btn btn-soft btn-sm" data-a="p">▶ Escuchar desde aquí</button><button class="btn btn-soft btn-sm" data-a="w">✎ Corregir palabra</button>`;
    const r = w.getBoundingClientRect();
    menu.style.left = (r.left + scrollX) + 'px'; menu.style.top = (r.bottom + scrollY + 4) + 'px';
    document.body.appendChild(menu);
    const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
    setTimeout(() => document.addEventListener('mousedown', off));
    menu.onclick = async (ev) => {
      const a = ev.target.dataset.a; if (!a) return;
      menu.remove();
      const rs = clip.ranges.map((x) => [...x]);
      if (a === 's') { if (words[i].s >= rs[rs.length - 1][1] - 1) return toast('El inicio debe ir antes del final', true); rs[0][0] = words[i].s; if (rs[0][0] >= rs[0][1]) rs[0][1] = rs[rs.length - 1][1]; change({ ranges: rs.filter((x) => x[1] - x[0] > 0.2) }); }
      if (a === 'e') { if (words[i].e <= rs[0][0] + 1) return toast('El final debe ir después del inicio', true); rs[rs.length - 1][1] = words[i].e; change({ ranges: rs.filter((x) => x[1] - x[0] > 0.2) }); }
      if (a === 'p') { pl.seek(Math.max(words[i].s, clip.ranges[0][0])); pl.play(); }
      if (a === 'w') {
        const nv = prompt('Corregir palabra', words[i].w);
        if (nv && nv.trim()) { words[i].w = nv.trim(); await api(`api/projects/${p.id}/transcript/words`, { method: 'PUT', body: { edits: [{ i, w: nv.trim() }] } }); paintTx(); pl.update(clip); toast('Corregido ✅'); }
      }
    };
  });

  // forma de onda
  const wave = $('#wave'), cv = $('canvas', wave);
  function drawWave() {
    if (!document.body.contains(wave)) return;
    const s = winS(), e = winE(), W = wave.clientWidth, Hh = wave.clientHeight;
    cv.width = W * devicePixelRatio; cv.height = Hh * devicePixelRatio;
    const ctx = cv.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
    const pk = tr.peaks || [];
    const n = Math.max(1, Math.floor(W / 3));
    for (let k = 0; k < n; k++) {
      const t0 = s + (e - s) * k / n, t1 = s + (e - s) * (k + 1) / n;
      let v = 0; for (let j = Math.floor(t0 * 10); j < Math.ceil(t1 * 10); j++) v = Math.max(v, pk[j] || 0);
      const h = Math.max(2, v / 255 * (Hh - 10));
      const inside = clip.ranges.some(([a, b]) => t0 >= a && t1 <= b);
      ctx.fillStyle = inside ? '#FFB020' : 'rgba(169,159,201,.45)';
      ctx.fillRect(k * 3, (Hh - h) / 2, 2, h);
    }
    $$('.rng,.hd', wave).forEach((x) => x.remove());
    const X = (t) => ((t - s) / (e - s)) * 100;
    clip.ranges.forEach(([a, b]) => { const d = document.createElement('div'); d.className = 'rng'; d.style.left = X(a) + '%'; d.style.width = (X(b) - X(a)) + '%'; wave.appendChild(d); });
    [['s', clip.ranges[0][0]], ['e', clip.ranges[clip.ranges.length - 1][1]]].forEach(([k, t]) => { const h = document.createElement('div'); h.className = 'hd'; h.dataset.k = k; h.style.left = X(t) + '%'; wave.appendChild(h); });
    $('#win').textContent = `${fmt(clip.ranges[0][0])} → ${fmt(clip.ranges[clip.ranges.length - 1][1])} · ${fmt(rangesDur(clip.ranges) / (clip.settings.speed || 1))}`;
  }
  let drag = null, dragWin = null;
  const tAt = (x) => { const r = wave.getBoundingClientRect(); const [s, e] = dragWin || [winS(), winE()]; return s + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (e - s); };
  wave.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.hd');
    if (h) { drag = h.dataset.k; dragWin = [winS(), winE()]; wave.setPointerCapture(e.pointerId); return; }
    const t = tAt(e.clientX);
    if (clip.ranges.some(([a, b]) => t >= a && t < b)) pl.seek(t);
  });
  wave.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = tAt(e.clientX);
    const rs = clip.ranges.map((x) => [...x]);
    const snap = (t, key) => { let best = t, bd = 0.6; for (const w of words) { const v = w[key]; if (Math.abs(v - t) < bd) { bd = Math.abs(v - t); best = v; } } return best; };
    if (drag === 's') rs[0][0] = Math.min(snap(t, 's'), rs[0][1] - 1);
    else rs[rs.length - 1][1] = Math.max(snap(t, 'e'), rs[rs.length - 1][0] + 1);
    clip.ranges = rs;
    const X = (tt) => ((tt - dragWin[0]) / (dragWin[1] - dragWin[0])) * 100;
    $$('.hd', wave).forEach((hd) => (hd.style.left = X(hd.dataset.k === 's' ? rs[0][0] : rs[rs.length - 1][1]) + '%'));
    $('#win').textContent = `${fmt(rs[0][0])} → ${fmt(rs[rs.length - 1][1])} · ${fmt(rangesDur(rs))}`;
  });
  wave.addEventListener('pointerup', () => { if (drag) { drag = null; dragWin = null; change({ ranges: clip.ranges }); } });
  new ResizeObserver(() => drawWave()).observe(wave);
  pl.onTime = (t) => {
    if (!document.body.contains(wave)) return;
    const s = winS(), e = winE();
    $('.ph', wave).style.left = ((t - s) / (e - s)) * 100 + '%';
    $('#tm').textContent = fmt(t - clip.ranges[0][0]);
    $('#pp').textContent = pl.playing ? '⏸' : '▶';
    const cur = $('#tx .wd.cur'); if (cur) cur.classList.remove('cur');
    if (pl.playing) { const i = words.findIndex((w) => t >= w.s && t < w.e + 0.15); const el = i >= 0 && $(`#tx .wd[data-i="${i}"]`); if (el) el.classList.add('cur'); }
  };
  $('#pp').onclick = () => (pl.playing ? pl.pause() : pl.play());
  $('#back').onclick = () => pl.stop();

  // panel derecho
  function panel() {
    const s = clip.settings, pc = $('#pc');
    $$('.ptabs button').forEach((b) => b.classList.toggle('on', +b.dataset.pt === ptab));
    if (ptab === 0) {
      pc.innerHTML = `<div class="row" style="margin-bottom:12px"><span class="switch"><input type="checkbox" id="capOn" ${s.captions !== false ? 'checked' : ''}><span></span></span><b>Mostrar subtítulos</b></div>
        <div class="styles">${Object.entries(STYLES).map(([k, v]) => `<div class="style-op ${s.captionStyle === k ? 'on' : ''}" data-s="${k}" style="--hl:${s.highlight};--capbox:${brand.primary || '#FF5A36'}"><div class="cap cap-${k}"><span class="w">${v}</span> <span class="w on">${k === 'minimal' ? '' : 'wow'}</span></div></div>`).join('')}</div>
        <div class="field" style="margin-top:16px"><label>Color de la palabra activa</label><div class="row"><input type="color" id="hl" value="${s.highlight || '#FFB020'}">${['#FFB020', '#FF5A36', '#3DD6B0', '#FF7AA8', '#7DF9FF', '#FFFFFF'].map((c) => `<button class="btn-icon" data-c="${c}" style="width:28px;height:28px;border-radius:50%;border:2px solid var(--line-2);background:${c};cursor:pointer"></button>`).join('')}</div></div>
        <div class="field"><label>Posición vertical</label><input type="range" id="cpos" min="0.15" max="0.9" step="0.01" value="${s.captionPos ?? 0.7}"></div>
        <div class="field"><label>Tamaño</label><input type="range" id="csz" min="0.6" max="1.5" step="0.05" value="${s.captionSize || 1}"></div>
        <label class="row small" style="margin-bottom:10px"><span class="switch"><input type="checkbox" id="emo" ${s.emojis === true ? 'checked' : ''}><span></span></span>Emojis automáticos <span class="tag">beta</span></label>
        <label class="row small"><span class="switch"><input type="checkbox" id="upp" ${s.upper ? 'checked' : ''}><span></span></span>TODO EN MAYÚSCULAS</label>`;
      $('#capOn').onchange = (e) => change({ settings: { captions: e.target.checked } });
      $$('.style-op').forEach((el) => el.onclick = () => { change({ settings: { captionStyle: el.dataset.s } }); panel(); });
      $('#hl').oninput = (e) => change({ settings: { highlight: e.target.value } });
      $$('[data-c]', pc).forEach((b) => b.onclick = () => { change({ settings: { highlight: b.dataset.c } }); panel(); });
      $('#cpos').oninput = (e) => change({ settings: { captionPos: +e.target.value } });
      $('#csz').oninput = (e) => change({ settings: { captionSize: +e.target.value } });
      $('#emo').onchange = (e) => change({ settings: { emojis: e.target.checked } });
      $('#upp').onchange = (e) => change({ settings: { upper: e.target.checked } });
    } else if (ptab === 1) {
      pc.innerHTML = `<div class="field"><label>Formato</label><div class="chips">${[['9:16', 'Vertical 9:16'], ['1:1', 'Cuadrado 1:1'], ['4:5', 'Retrato 4:5'], ['16:9', 'Horizontal 16:9']].map(([k, v]) => `<button class="chip ${s.aspect === k ? 'on' : ''}" data-a="${k}">${v}</button>`).join('')}</div></div>
        <div class="field"><label>Encuadre</label><div class="chips">${[['face', '🙂 Seguir la cara'], ['center', '⊡ Centro'], ['fit', '▣ Plano completo']].map(([k, v]) => `<button class="chip ${s.reframe === k ? 'on' : ''}" data-r="${k}">${v}</button>`).join('')}</div></div>
        <div class="field ${s.reframe === 'fit' ? 'hidden' : ''}"><label>Posición horizontal del encuadre ${s.cropX == null ? '<span class="tag">automática</span>' : ''}</label><input type="range" id="cx" min="0" max="1" step="0.01" value="${s.cropX ?? 0.5}"><button class="btn btn-ghost btn-sm" id="cxa" style="align-self:flex-start;margin-top:6px">Volver a automático</button></div>
        <p class="muted small">«Seguir la cara» busca a quien habla al montar el clip. Puedes moverlo a mano si prefieres otro encuadre.</p>`;
      $$('[data-a]', pc).forEach((b) => b.onclick = () => { change({ settings: { aspect: b.dataset.a } }); panel(); });
      $$('[data-r]', pc).forEach((b) => b.onclick = () => { change({ settings: { reframe: b.dataset.r, cropX: b.dataset.r === 'center' ? 0.5 : null } }); panel(); });
      $('#cx') && ($('#cx').oninput = (e) => change({ settings: { cropX: +e.target.value } }));
      $('#cxa') && ($('#cxa').onclick = () => { change({ settings: { cropX: null, reframe: 'face' } }); panel(); });
    } else if (ptab === 2) {
      pc.innerHTML = `<div class="field"><label>Velocidad · <b id="spv">${s.speed || 1}×</b></label><input type="range" id="sp" min="0.75" max="1.5" step="0.05" value="${s.speed || 1}"><div class="chips" style="margin-top:6px">${[1, 1.1, 1.25, 1.5].map((v) => `<button class="chip ${+s.speed === v ? 'on' : ''}" data-v="${v}">${v}×</button>`).join('')}</div></div>
        <label class="row small" style="margin-bottom:12px"><span class="switch"><input type="checkbox" id="rf" ${s.removeFillers ? 'checked' : ''}><span></span></span>Quitar muletillas («eh», «em», «mmm»…)</label>
        <label class="row small" style="margin-bottom:12px"><span class="switch"><input type="checkbox" id="br" ${s.brand !== false ? 'checked' : ''}><span></span></span>Aplicar mi kit de marca (logo y cierre)</label>
        ${clip.thread_id ? '' : `<div class="field" style="margin-top:16px"><label>Tramos del clip</label>${clip.ranges.map(([a, b], i) => `<div class="row small" style="margin-bottom:6px"><span class="tag">${i + 1}</span><span class="mono">${fmt(a)} → ${fmt(b)}</span><div class="spacer"></div>${clip.ranges.length > 1 ? `<button class="btn btn-ghost btn-sm" data-rm="${i}">Quitar</button>` : ''}</div>`).join('')}</div>`}
        <p class="muted small">Consejo: 1,1× suele dar más ritmo sin que se note.</p>`;
      const setSp = (v) => { $('#spv').textContent = v + '×'; change({ settings: { speed: v } }); drawWave(); };
      $('#sp').oninput = (e) => setSp(+e.target.value);
      $$('[data-v]', pc).forEach((b) => b.onclick = () => { setSp(+b.dataset.v); panel(); });
      $('#rf').onchange = (e) => change({ settings: { removeFillers: e.target.checked } });
      $('#br').onchange = (e) => change({ settings: { brand: e.target.checked } });
      $$('[data-rm]', pc).forEach((b) => b.onclick = () => { change({ ranges: clip.ranges.filter((_, i) => i !== +b.dataset.rm) }); panel(); });
    } else if (ptab === 3) {
      pc.innerHTML = `<div class="field"><label>Gancho en pantalla (primeros 3 s)</label><input class="input" id="hk" value="${esc(clip.hook || '')}" maxlength="80"><label class="row small" style="margin-top:6px"><span class="switch"><input type="checkbox" id="shk" ${s.showHook !== false ? 'checked' : ''}><span></span></span>Mostrar gancho</label></div>
        ${clip.thread_id != null ? `
          ${clip.part_index > 0 ? `<div class="field"><label>Resumen «Antes…» (inicio)</label><input class="input" data-k="recap" value="${esc(s.recap || '')}"></div>` : ''}
          ${clip.part_index < 2 ? `<div class="field"><label>Frase de suspense (imagen congelada)</label><textarea class="input" data-k="cliffhanger">${esc(s.cliffhanger || '')}</textarea></div>` : ''}
          <div class="field"><label>Tarjeta final · título</label><input class="input" data-k="ctaTitle" value="${esc(s.ctaTitle || (clip.part_index < 2 ? `▶ Parte ${clip.part_index + 2} en mi perfil` : 'Fin de la historia'))}"></div>
          <div class="field"><label>Tarjeta final · línea</label><input class="input" data-k="ctaLine" value="${esc(s.ctaLine || (clip.part_index < 2 ? 'Sígueme para no perderte lo que pasa' : '¿Te gustó? Sígueme para más'))}"></div>
          <p class="muted small">Tu @usuario se añade a la tarjeta desde el Kit de marca.</p>` : '<p class="muted small">El cierre con tu @usuario se activa en el Kit de marca.</p>'}`;
      $('#hk').oninput = (e) => change({ hook: e.target.value });
      $('#shk').onchange = (e) => change({ settings: { showHook: e.target.checked } });
      $$('[data-k]', pc).forEach((inp) => inp.addEventListener('input', () => change({ settings: { [inp.dataset.k]: inp.value, ...(inp.dataset.k === 'cliffhanger' ? { cliffhangerEdited: true } : {}) } })));
    } else if (ptab === 4) {
      pc.innerHTML = `<div class="field"><label>Red</label><select class="input" id="pn">${Object.entries(NETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label>Texto del post</label><textarea class="input" id="pt" style="min-height:160px">${esc(clip.post_text || '')}</textarea></div>
        <div class="row wrap"><button class="btn btn-soft btn-sm" id="pg">✨ Generar con ${me.ai ? 'IA' : 'plantilla'}</button><button class="btn btn-ghost btn-sm" id="pcp">Copiar</button><div class="spacer"></div><button class="btn btn-primary btn-sm" id="psch">📅 Planificar</button></div>`;
      $('#pt').oninput = (e) => change({ post_text: e.target.value });
      $('#pg').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Escribiendo…'; try { const r = await api(`api/clips/${id}/post-text`, { method: 'POST', body: { network: $('#pn').value } }); clip.post_text = r.text; $('#pt').value = r.text; } catch (err) { toast(err.message, true); } e.target.disabled = false; e.target.textContent = `✨ Generar con ${me.ai ? 'IA' : 'plantilla'}`; };
      $('#pcp').onclick = () => { navigator.clipboard?.writeText($('#pt').value); toast('Texto copiado ✅'); };
      $('#psch').onclick = () => scheduleModal(clip);
    } else if (ptab === 5) {
      pc.innerHTML = '<p class="muted small">Todo se guarda solo. Aquí puedes volver a cualquier versión anterior.</p><div class="versions" id="vl">Cargando…</div><button class="btn btn-soft btn-sm" id="snap" style="margin-top:12px">📌 Guardar versión ahora</button>';
      const load = async () => {
        const vs = await api(`api/clips/${id}/versions`);
        $('#vl').innerHTML = vs.length ? vs.map((v) => `<div><span>${esc(v.label)}</span><span class="muted">${new Date(v.created * 1000).toLocaleString('es')}</span><div class="spacer"></div><button class="btn btn-ghost btn-sm" data-v="${v.id}">Restaurar</button></div>`).join('') : '<p class="muted small">Aún no hay versiones anteriores.</p>';
        $$('[data-v]', $('#vl')).forEach((b) => b.onclick = async () => { clip = { ...clip, ...(await api(`api/clips/${id}/versions/${b.dataset.v}/restore`, { method: 'POST' })) }; pl.update(clip); drawWave(); paintTx(); $('#ctitle').textContent = clip.title; toast('Versión restaurada ✅'); load(); });
      };
      load();
      $('#snap').onclick = async () => { await api(`api/clips/${id}`, { method: 'PATCH', body: { label: 'Versión guardada a mano' } }); toast('Versión guardada ✅'); load(); };
    }
  }
  $$('.ptabs button').forEach((b) => b.onclick = () => { ptab = +b.dataset.pt; panel(); });
  panel();

  const dlBtn = $('#dl');
  dlBtn.onclick = async () => { await flushNow(); startDownload(+id); dlBtn.disabled = true; dlBtn.textContent = 'Preparando…'; };
  async function flushNow() { if (Object.keys(pending).length) { const body = pending; pending = {}; clip = { ...clip, ...(await api(`api/clips/${id}`, { method: 'PATCH', body })) }; } }
  $('#dup').onclick = async () => { await flushNow(); const r = await api(`api/clips/${id}/duplicate`, { method: 'POST' }); location.hash = `#/clip/${r.id}`; };
  onView((m) => {
    if (m.type === 'render' && m.clipId === +id) {
      if (m.status === 'done' || m.status === 'error') { dlBtn.disabled = false; dlBtn.textContent = '⬇ Descargar MP4'; if (m.status === 'done') toast('Clip montado ✅'); }
      else dlBtn.textContent = m.status === 'queued' ? 'En cola…' : `Montando ${Math.round((m.progress || 0) * 100)}%`;
    }
    if (m.type === 'queue' && m.ref.clip === +id && m.position > 1) dlBtn.textContent = `En cola (${m.position - 1} antes)`;
  });
}

// ----- calendario -----
async function viewCalendar() {
  let base = new Date(); base.setDate(1); base.setHours(0, 0, 0, 0);
  app.innerHTML = shell('calendario', `<div class="page-head"><h1>Calendario</h1><div class="spacer"></div><button class="btn btn-soft btn-icon" id="prev">‹</button><b id="mon" style="min-width:160px;text-align:center;font-family:var(--display);font-size:20px"></b><button class="btn btn-soft btn-icon" id="next">›</button><button class="btn btn-ghost btn-sm" id="today">Hoy</button></div>
    <p class="muted" style="margin-top:-12px">Planifica tus clips: cada publicación lleva el clip y el texto listos para descargar y copiar.</p>
    <div class="cal" id="cal"></div>`);
  bindShell();
  const draw = async () => {
    const y = base.getFullYear(), mth = base.getMonth();
    $('#mon').textContent = base.toLocaleDateString('es', { month: 'long', year: 'numeric' });
    const first = new Date(y, mth, 1), startDow = (first.getDay() + 6) % 7;
    const start = new Date(y, mth, 1 - startDow);
    const end = new Date(start); end.setDate(end.getDate() + 42);
    const posts = await api(`api/posts?from=${Math.floor(start / 1000)}&to=${Math.floor(end / 1000)}`);
    const today = new Date().toDateString();
    let html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const ps = posts.filter((p) => new Date(p.at * 1000).toDateString() === d.toDateString());
      html += `<div class="day ${d.getMonth() !== mth ? 'other' : ''} ${d.toDateString() === today ? 'today' : ''}"><span class="n">${d.getDate()}</span>${ps.map((p) => `<div class="post net-${p.network} ${p.status === 'publicado' ? 'done' : ''}" data-id="${p.id}" title="${esc(p.clip_title)}">${new Date(p.at * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} ${esc(NETS[p.network] || p.network)} · ${p.thread_id ? `${p.part_index + 1}/3 ` : ''}${esc(p.clip_title)}</div>`).join('')}</div>`;
    }
    $('#cal').innerHTML = html;
    $$('.post').forEach((el) => el.onclick = () => postModal(posts.find((p) => p.id === +el.dataset.id), draw));
  };
  $('#prev').onclick = () => { base.setMonth(base.getMonth() - 1); draw(); };
  $('#next').onclick = () => { base.setMonth(base.getMonth() + 1); draw(); };
  $('#today').onclick = () => { base = new Date(); base.setDate(1); draw(); };
  draw();
  onView((m) => { if (m.type === 'render' && pendingDownloads.size === 0) {} });
}
function postModal(p, redraw) {
  modal(`<h3>${esc(p.clip_title)}</h3>
    <div class="field"><label>Red</label><select class="input" id="pn">${Object.entries(NETS).map(([k, v]) => `<option value="${k}" ${k === p.network ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label>Fecha y hora</label><input class="input" type="datetime-local" id="pd" value="${toLocal(new Date(p.at * 1000))}"></div>
    <div class="field"><label>Texto</label><textarea class="input" id="pt" style="min-height:140px">${esc(p.text || '')}</textarea></div>
    <label class="row small" style="margin-bottom:16px"><span class="switch"><input type="checkbox" id="ps" ${p.status === 'publicado' ? 'checked' : ''}><span></span></span>Ya publicado</label>
    <div class="row wrap"><button class="btn btn-ghost btn-sm" id="del">Quitar</button><div class="spacer"></div><button class="btn btn-soft btn-sm" id="cp">Copiar texto</button><button class="btn btn-soft btn-sm" id="dl">⬇ Clip</button><a class="btn btn-soft btn-sm" href="#/clip/${p.clip_id}">Editar clip</a><button class="btn btn-primary btn-sm" id="sv">Guardar</button></div>`, (m, close) => {
    $('#cp', m).onclick = () => { navigator.clipboard?.writeText($('#pt', m).value); toast('Texto copiado ✅'); };
    $('#dl', m).onclick = (e) => startDownload(p.clip_id, e.target);
    $('#del', m).onclick = async () => { await api(`api/posts/${p.id}`, { method: 'DELETE' }); close(); redraw(); };
    $('#sv', m).onclick = async () => { await api(`api/posts/${p.id}`, { method: 'PATCH', body: { network: $('#pn', m).value, at: Math.floor(new Date($('#pd', m).value).getTime() / 1000), text: $('#pt', m).value, status: $('#ps', m).checked ? 'publicado' : 'planificado' } }); close(); redraw(); toast('Guardado ✅'); };
  });
}

// ----- kit de marca -----
async function viewBrand() {
  brand = await api('api/brand');
  app.innerHTML = shell('marca', `<div class="page-head"><h1>Kit de marca</h1><span class="saved" id="saved"></span></div>
    <p class="muted" style="margin-top:-12px">Se aplica a todos los clips de este espacio: subtítulos, logo, etiquetas del hilo y tarjeta final.</p>
    <div class="editor" style="grid-template-columns:minmax(300px,1fr) minmax(260px,340px)">
      <div class="panel">
        <div class="field"><label>Logo (PNG con fondo transparente)</label><div class="row">${brand.logo ? `<img src="media/brand/logo?v=${esc(brand.logo)}" style="height:48px;border-radius:8px;background:var(--ink-3);padding:4px">` : ''}<label class="btn btn-soft btn-sm" style="cursor:pointer">${brand.logo ? 'Cambiar' : 'Subir logo'}<input type="file" id="lg" accept="image/*" hidden></label>${brand.logo ? '<button class="btn btn-ghost btn-sm" id="lgx">Quitar</button>' : ''}</div></div>
        <div class="field"><label>Esquina del logo</label><div class="chips">${[['tl', '↖ Arriba izq.'], ['tr', '↗ Arriba der.'], ['bl', '↙ Abajo izq.'], ['br', '↘ Abajo der.']].map(([k, v]) => `<button class="chip ${brand.logoPos === k ? 'on' : ''}" data-lp="${k}">${v}</button>`).join('')}</div></div>
        <div class="row" style="gap:24px"><div class="field"><label>Color principal</label><input type="color" id="c1" value="${brand.primary || '#FF5A36'}"></div><div class="field"><label>Color de resalte</label><input type="color" id="c2" value="${brand.accent || '#FFB020'}"></div></div>
        <div class="field"><label>Tipografía de subtítulos</label><select class="input" id="fn">${(brand.fonts || []).map((f) => `<option ${f === brand.font ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label>Tu @usuario (aparece en la tarjeta «sigue en mi perfil»)</label><input class="input" id="hd" placeholder="@tucuenta" value="${esc(brand.handle || '')}"></div>
        <label class="row small" style="margin:8px 0 12px"><span class="switch"><input type="checkbox" id="ou" ${brand.outro ? 'checked' : ''}><span></span></span>Añadir tarjeta de cierre a los clips sueltos</label>
        <div class="row ${brand.outro ? '' : 'hidden'}" id="oub" style="align-items:flex-start"><div class="field" style="flex:1"><label>Título del cierre</label><input class="input" id="ot" value="${esc(brand.outroTitle || '')}" placeholder="Sígueme"></div><div class="field" style="flex:1"><label>Línea</label><input class="input" id="ol" value="${esc(brand.outroLine || '')}" placeholder="Más clips en mi perfil"></div></div>
      </div>
      <div class="stage"><div id="prev"></div><p class="muted small" style="text-align:center">Vista previa con un clip de ejemplo</p></div>
    </div>`);
  bindShell();
  const drawPrev = () => {
    const box = $('#prev');
    box.innerHTML = `<div class="phone" style="background:linear-gradient(170deg,#3a2c63,#1d1636);--hl:${brand.accent};--brand:${brand.primary};--capfont:'${brand.font}'"><div class="ov"><div class="badge">1/3</div>${brand.logo ? `<img class="logo-ov" src="media/brand/logo?v=${esc(brand.logo)}" style="${(brand.logoPos || 'tr').includes('r') ? 'right:4%' : 'left:4%'};${(brand.logoPos || 'tr').includes('b') ? 'bottom:4%' : `top:${(brand.logoPos || 'tr').includes('r') ? 4 : 10}%`}">` : ''}
      <div class="hp" style="position:absolute;inset:0;width:auto;transform:none;border:0;box-shadow:none;border-radius:0;background:transparent"><div class="face"></div><div class="body"></div></div>
      <div class="cap cap-karaoke" style="top:70%"><span class="w">Esto</span> <span class="w on">cambia</span> <span class="w">todo</span> 🔥</div>
      <div class="endcard" style="top:auto;height:24%;inset:auto 0 0 0;animation:none"><b>▶ Parte 2 en mi perfil</b>${brand.handle ? `<em>${esc(brand.handle)}</em>` : ''}</div></div></div>`;
  };
  drawPrev();
  const save = debounce(async () => { brand = { ...brand, ...(await api('api/brand', { method: 'PUT', body: brand })) }; if ($('#saved')) if ($('#saved')) $('#saved').textContent = 'Guardado ✓'; setTimeout(() => $('#saved') && ($('#saved').textContent = ''), 1500); }, 500);
  const set = (k, v) => { brand[k] = v; drawPrev(); save(); };
  $('#c1').oninput = (e) => set('primary', e.target.value);
  $('#c2').oninput = (e) => set('accent', e.target.value);
  $('#fn').onchange = (e) => set('font', e.target.value);
  $('#hd').oninput = (e) => set('handle', e.target.value);
  $('#ou').onchange = (e) => { set('outro', e.target.checked); $('#oub').classList.toggle('hidden', !e.target.checked); };
  $('#ot').oninput = (e) => set('outroTitle', e.target.value);
  $('#ol').oninput = (e) => set('outroLine', e.target.value);
  $$('[data-lp]').forEach((b) => b.onclick = () => { set('logoPos', b.dataset.lp); $$('[data-lp]').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#lg').onchange = async (e) => { const fd = new FormData(); fd.append('logo', e.target.files[0]); try { await api('api/brand/logo', { method: 'POST', body: fd }); toast('Logo guardado ✅'); viewBrand(); } catch (err) { toast(err.message, true); } };
  $('#lgx') && ($('#lgx').onclick = async () => { await api('api/brand/logo', { method: 'DELETE' }); viewBrand(); });
}

// ----- equipo -----
async function viewTeam() {
  const w = await api('api/workspace');
  const link = `${location.origin}${location.pathname}#/unirse/${w.invite_code}`;
  app.innerHTML = shell('equipo', `<div class="page-head"><h1>Equipo</h1></div>
    <div class="card" style="max-width:720px">
      <div class="field"><label>Nombre del espacio</label><input class="input" id="wn" value="${esc(w.name)}"></div>
      ${w.isOwner ? `<div class="field"><label>Enlace de invitación</label><div class="row"><input class="input" readonly value="${esc(link)}" id="lk"><button class="btn btn-primary btn-sm" id="cp">Copiar</button></div><button class="btn btn-ghost btn-sm" id="rg" style="align-self:flex-start;margin-top:6px">Crear enlace nuevo (anula el anterior)</button></div>` : ''}
      <h3 style="margin:22px 0 12px;font-size:18px">Miembros</h3>
      ${w.members.map((m) => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line)"><span class="avatar">${esc((m.name || m.email)[0].toUpperCase())}</span><div><b>${esc(m.name)}</b><div class="muted small">${esc(m.email)}</div></div><div class="spacer"></div><span class="tag">${esc(m.role)}</span>${(w.isOwner && m.role !== 'propietario') || (m.id === me.user.id && m.role !== 'propietario') ? `<button class="btn btn-ghost btn-sm" data-rm="${m.id}">${m.id === me.user.id ? 'Salir' : 'Quitar'}</button>` : ''}</div>`).join('')}
    </div>
    <div class="card" style="max-width:720px;margin-top:18px"><h3 style="font-size:18px;margin-bottom:8px">Otro espacio</h3><p class="muted small">Útil si llevas varias marcas o clientes: cada espacio tiene sus proyectos, kit de marca y calendario.</p><div class="row"><input class="input" id="nw" placeholder="Nombre del nuevo espacio"><button class="btn btn-soft" id="nwb">Crear</button></div></div>`);
  bindShell();
  $('#wn').addEventListener('change', async (e) => { await api('api/workspace', { method: 'PATCH', body: { name: e.target.value } }); await loadMe(); viewTeam(); toast('Guardado ✅'); });
  $('#cp') && ($('#cp').onclick = () => { navigator.clipboard?.writeText(link); toast('Enlace copiado ✅'); });
  $('#rg') && ($('#rg').onclick = async () => { await api('api/workspace/invite', { method: 'POST' }); viewTeam(); });
  $$('[data-rm]').forEach((b) => b.onclick = async () => { await api(`api/workspace/members/${b.dataset.rm}`, { method: 'DELETE' }); await loadMe(); viewTeam(); });
  $('#nwb').onclick = async () => { await api('api/workspaces', { method: 'POST', body: { name: $('#nw').value || 'Nuevo espacio' } }); await loadMe(); toast('Espacio creado ✅'); viewTeam(); };
}

async function viewJoin(code) {
  try { const r = await api(`api/join/${code}`, { method: 'POST' }); await loadMe(); toast(`Te has unido a «${r.name}» ✅`); }
  catch (e) { toast(e.message, true); }
  location.hash = '#/proyectos';
}

// ---------- arranque y rutas ----------
async function loadMe() {
  try { me = await api('api/me'); brand = await api('api/brand'); connect(); } catch { me = null; }
}
async function route() {
  cleanup.splice(0).forEach((fn) => fn());
  $$('.modal-bg,.wmenu').forEach((x) => x.remove());
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [r, a, b] = parts;
  window.scrollTo(0, 0);
  if (!me) {
    if (r === 'unirse') { sessionStorage.setItem('yc_after', location.hash); return viewAuth('registro'); }
    if (r === 'entrar' || r === 'registro') return viewAuth(r);
    if (r && r !== '') { sessionStorage.setItem('yc_after', location.hash); return viewAuth('entrar'); }
    return viewLanding();
  }
  try {
    if (!r || r === 'proyectos' || r === 'entrar' || r === 'registro') return await viewProjects();
    if (r === 'p') return await viewProject(a, b);
    if (r === 'clip') return await viewClip(a);
    if (r === 'calendario') return await viewCalendar();
    if (r === 'marca') return await viewBrand();
    if (r === 'equipo') return await viewTeam();
    if (r === 'unirse') return await viewJoin(a);
    location.hash = '#/proyectos';
  } catch (e) {
    if (e.status === 401) { me = null; return route(); }
    app.innerHTML = shell('', `<div class="empty"><div class="big">🧭</div><h3 style="color:var(--cream)">${esc(e.message)}</h3><p><a href="#/proyectos">Volver a mis proyectos</a></p></div>`);
    bindShell();
  }
}
window.addEventListener('hashchange', route);
(async () => { await loadMe(); route(); })();
})();
