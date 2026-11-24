// Montaje del clip final: tramos, encuadre, velocidad, subtitulos, marca y extras del hilo.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const H = require('./heuristics');

const DIMS = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };
const FONTS = ['Montserrat', 'Roboto', 'Open Sans', 'Lato', 'DejaVu Sans'];

const DEFAULT_SETTINGS = {
  aspect: '9:16', reframe: 'face', cropX: null, captions: true, captionStyle: 'karaoke',
  captionPos: 0.7, captionSize: 1, highlight: '#FFB020', emojis: false, speed: 1,
  removeFillers: false, showHook: true, brand: true, upper: false,
};

const EMOJI = [
  [/dinero|money|euros?|dólares?|pagar|precio/i, '💰'], [/fuego|brutal|increíble|épico|fire/i, '🔥'],
  [/idea|truco|consejo|tip/i, '💡'], [/jaja|risa|gracioso|funny/i, '😂'], [/amor|quiero|love|corazón/i, '❤️'],
  [/miedo|susto|terror/i, '😱'], [/error|mal|problema|fail/i, '⚠️'], [/tiempo|reloj|minutos?|horas?/i, '⏱️'],
  [/ganar|victoria|win|éxito/i, '🏆'], [/juego|partida|game|jugar/i, '🎮'], [/clase|aprender|estudiar|learn/i, '📚'],
  [/empresa|negocio|business|cliente/i, '💼'], [/música|canción|music/i, '🎵'], [/cohete|crecer|subir|growth/i, '🚀'],
];

const assColor = (hex, alpha = '00') => {
  const h = (hex || '#FFFFFF').replace('#', '').padEnd(6, 'F');
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const assTime = (t) => {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};
const esc = (s) => String(s || '').replace(/[{}]/g, '').replace(/\n/g, '\\N');

// Tramos que se conservan (quitando muletillas si se pide)
function keptIntervals(words, ranges, removeFillers) {
  const out = [];
  for (const [s, e] of ranges) {
    if (!removeFillers) { out.push([s, e]); continue; }
    let cur = s;
    for (const w of words) {
      if (w.s < s || w.e > e) continue;
      if (H.isFiller(w.w)) { if (w.s - cur > 0.05) out.push([cur, w.s]); cur = w.e; }
    }
    if (e - cur > 0.05) out.push([cur, e]);
  }
  return out;
}

function makeMapper(intervals, speed) {
  return (t) => {
    let acc = 0;
    for (const [s, e] of intervals) {
      if (t < s) return acc / speed;
      if (t <= e) return (acc + t - s) / speed;
      acc += e - s;
    }
    return acc / speed;
  };
}

function clipWords(words, intervals) {
  return words.filter((w) => intervals.some(([s, e]) => w.s >= s - 0.01 && w.e <= e + 0.01) && w.w.trim());
}

function groupWords(ws, maxWords, maxChars) {
  const groups = [];
  let g = [];
  ws.forEach((w, i) => {
    g.push(w);
    const chars = g.map((x) => x.w).join(' ').length;
    const next = ws[i + 1];
    if (g.length >= maxWords || chars >= maxChars || /[.!?,;:]$/.test(w.w) || !next || next.s - w.e > 0.6) { groups.push(g); g = []; }
  });
  return groups;
}

function buildAss({ words, intervals, settings, brand, dims, extras, duration }) {
  const [W, Hh] = dims;
  const st = { ...DEFAULT_SETTINGS, ...settings };
  const font = FONTS.includes(brand.font) ? brand.font : 'Montserrat';
  const base = Math.round((W < Hh ? 96 : W === Hh ? 88 : 70) * (st.captionSize || 1));
  const hl = assColor(st.highlight || brand.accent || '#FFB020');
  const prim = assColor(brand.primary || '#FF5A36');
  const ink = assColor('#1B1630');
  const cream = assColor('#FFF7EC');
  const styles = {
    karaoke: `Style: Cap,${font},${base},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,2,0,1,${Math.round(base / 14)},${Math.round(base / 22)},5,40,40,0,1`,
    caja: `Style: Cap,${font},${base},&H00FFFFFF,&H00FFFFFF,${prim},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(base / 5)},0,5,40,40,0,1`,
    neon: `Style: Cap,${font},${base},${hl},&H00FFFFFF,${hl},&H00000000,-1,0,0,0,100,100,1,0,1,2,0,5,40,40,0,1`,
    minimal: `Style: Cap,${font},${Math.round(base * 0.75)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,2,3,5,40,40,0,1`,
    comic: `Style: Cap,${font},${Math.round(base * 1.15)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${Math.round(base / 9)},${Math.round(base / 14)},5,40,40,0,1`,
  };
  const capStyle = styles[st.captionStyle] || styles.karaoke;
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${Hh}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    capStyle,
    `Style: Hook,${font},${Math.round(base * 0.6)},${ink},&H00FFFFFF,${cream},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(base / 4)},0,8,90,90,${Math.round(Hh * 0.13)},1`,
    `Style: Badge,${font},${Math.round(base * 0.8)},&H00FFFFFF,&H00FFFFFF,${prim},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(base / 5)},0,7,50,50,${Math.round(Hh * 0.04)},1`,
    `Style: Recap,${font},${Math.round(base * 0.55)},${cream},&H00FFFFFF,&H50000000,&H00000000,0,1,0,0,100,100,0,0,3,${Math.round(base / 5)},0,8,70,70,${Math.round(Hh * 0.17)},1`,
    `Style: Cliff,${font},${Math.round(base * 0.95)},&H00FFFFFF,&H00FFFFFF,${ink},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(base / 3)},0,5,80,80,0,1`,
    `Style: Card,${font},${Math.round(base * 1.2)},${cream},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,80,80,0,1`,
    `Style: Handle,${font},${Math.round(base * 0.75)},${hl},&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,80,80,0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const ev = (layer, s, e, style, text) => lines.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${style},,0,0,0,,${text}`);
  const map = makeMapper(intervals, st.speed || 1);
  const capY = Math.round(Hh * st.captionPos);
  const pos = `{\\an5\\pos(${W / 2},${capY})}`;

  if (st.captions) {
    const ws = clipWords(words, intervals).filter((w) => !(st.removeFillers && H.isFiller(w.w)));
    const per = st.captionStyle === 'minimal' ? 7 : st.captionStyle === 'comic' ? 2 : 3;
    const groups = groupWords(ws, per, W < Hh ? 22 : 40);
    groups.forEach((g, gi) => {
      const gs = map(g[0].s), ge = Math.max(map(g[g.length - 1].e), gs + 0.3);
      const nextS = groups[gi + 1] ? map(groups[gi + 1][0].s) : ge + 0.4;
      const end = Math.min(nextS, ge + 0.4);
      const txt = (w) => esc(st.upper || st.captionStyle === 'comic' ? w.w.toUpperCase() : w.w);
      let emoji = '';
      if (st.emojis) { const all = g.map((w) => w.w).join(' '); const m = EMOJI.find(([re]) => re.test(all)); if (m) emoji = ' ' + m[1]; }
      if (st.captionStyle === 'minimal') { ev(1, gs, end, 'Cap', pos + g.map(txt).join(' ') + emoji); return; }
      g.forEach((w, wi) => {
        const s = wi === 0 ? gs : map(w.s);
        const e = wi === g.length - 1 ? end : map(g[wi + 1].s);
        if (e <= s) return;
        const parts = g.map((x, xi) => {
          if (xi !== wi) return txt(x);
          if (st.captionStyle === 'comic') return `{\\c${hl}\\fscx115\\fscy115}${txt(x)}{\\r}`;
          if (st.captionStyle === 'caja') return `{\\c${ink}\\3c${hl}}${txt(x)}{\\r}`;
          if (st.captionStyle === 'neon') return `{\\c&H00FFFFFF&\\blur3}${txt(x)}{\\r}`;
          return `{\\c${hl}}${txt(x)}{\\r}`;
        });
        ev(1, s, e, 'Cap', pos + parts.join(' ') + emoji);
      });
    });
  }
  const main = map(intervals[intervals.length - 1][1]);
  if (st.showHook && extras.hook && !extras.recap) ev(2, 0, Math.min(3, main), 'Hook', `{\\fad(150,250)}${esc(extras.hook)}`);
  if (extras.badge) ev(3, 0, duration, 'Badge', esc(extras.badge));
  if (extras.recap) ev(2, 0, Math.min(3.2, main), 'Recap', `{\\fad(150,300)}${esc(extras.recap)}`);
  if (extras.cliffhanger) ev(4, main, main + 1.6, 'Cliff', `{\\an5\\pos(${W / 2},${Hh / 2})\\fad(120,0)\\t(0,300,\\fscx106\\fscy106)}${esc(extras.cliffhanger)}`);
  if (extras.card) {
    const cs = main + (extras.cliffhanger ? 1.6 : 0), ce = cs + 2.2;
    ev(5, cs, ce, 'Card', `{\\an7\\pos(0,0)\\p1\\c${ink}\\bord0\\shad0}m 0 0 l ${W} 0 ${W} ${Hh} 0 ${Hh}{\\p0}`);
    ev(6, cs, ce, 'Card', `{\\an5\\pos(${W / 2},${Hh * 0.42})\\c${prim}\\fad(150,0)}${esc(extras.card.title)}`);
    ev(6, cs, ce, 'Card', `{\\an5\\pos(${W / 2},${Hh * 0.52})}${esc(extras.card.line)}`);
    if (extras.card.handle) ev(6, cs, ce, 'Handle', `{\\an5\\pos(${W / 2},${Hh * 0.6})}${esc(extras.card.handle)}`);
    ev(7, cs, ce, 'Card', `{\\an5\\move(${W / 2 - 50},${Hh * 0.7},${W / 2 + 50},${Hh * 0.7},0,700)\\c${prim}\\fs${Math.round(base * 1.6)}}➜`);
  }
  return lines.join('\n') + '\n';
}

function run(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); if (onLine) String(d).split(/\r|\n/).forEach(onLine); });
    p.stdout.on('data', (d) => { if (onLine) String(d).split(/\r|\n/).forEach(onLine); });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} fallo (${c}): ${err.slice(-600)}`))));
  });
}

function faceX(src, s, e) {
  return new Promise((resolve) => {
    const p = spawn(process.env.PYTHON_BIN || 'python3', [path.join(__dirname, '..', 'py', 'faces.py'), src, String(s), String(e)]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => { try { resolve(JSON.parse(out).x); } catch { resolve(0.5); } });
    p.on('error', () => resolve(0.5));
  });
}

// Genera el MP4 final. extras: {hook, badge, recap, cliffhanger, card:{title,line,handle}}
async function renderClip({ src, srcW, srcH, words, ranges, settings, brand, logoPath, extras, out, onProgress }) {
  const st = { ...DEFAULT_SETTINGS, ...settings };
  const speed = Math.min(2, Math.max(0.5, +st.speed || 1));
  const intervals = keptIntervals(words, ranges, st.removeFillers);
  const mainDur = intervals.reduce((a, [s, e]) => a + (e - s), 0) / speed;
  const tail = (extras.cliffhanger ? 1.6 : 0) + (extras.card ? 2.2 : 0);
  const duration = mainDur + tail;
  const dims = DIMS[st.aspect] || DIMS['9:16'];
  const [W, Hh] = dims;
  let cropX = st.cropX;
  if (cropX == null && st.reframe === 'face') cropX = await faceX(src, ranges[0][0], ranges[ranges.length - 1][1]);
  if (cropX == null) cropX = 0.5;

  const assPath = out.replace(/\.mp4$/, '.ass');
  fs.writeFileSync(assPath, buildAss({ words, intervals, settings: st, brand, dims, extras, duration }));

  const f = [];
  intervals.forEach(([s, e], i) => {
    f.push(`[0:v]trim=start=${s.toFixed(3)}:end=${e.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    f.push(`[0:a]atrim=start=${s.toFixed(3)}:end=${e.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  f.push(`${intervals.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${intervals.length}:v=1:a=1[vc][ac]`);
  const r = W / Hh, sr = srcW / srcH;
  if (st.reframe === 'fit') {
    f.push(`[vc]split[bg0][fg0]`);
    f.push(`[bg0]scale=${W}:${Hh}:force_original_aspect_ratio=increase,crop=${W}:${Hh},boxblur=24:2,eq=brightness=-0.08[bg]`);
    f.push(`[fg0]scale=${W}:${Hh}:force_original_aspect_ratio=decrease[fg]`);
    f.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vs]`);
  } else if (sr > r) {
    const cw = Math.round(srcH * r / 2) * 2;
    const cx = Math.round(Math.min(srcW - cw, Math.max(0, cropX * srcW - cw / 2)));
    f.push(`[vc]crop=${cw}:${srcH}:${cx}:0,scale=${W}:${Hh},setsar=1[vs]`);
  } else {
    const ch = Math.round(srcW / r / 2) * 2;
    f.push(`[vc]crop=${srcW}:${ch}:0:${Math.round((srcH - ch) / 2)},scale=${W}:${Hh},setsar=1[vs]`);
  }
  let v = '[vs]', a = '[ac]';
  if (speed !== 1) { f.push(`${v}setpts=PTS/${speed}[vsp]`); f.push(`${a}atempo=${speed}[asp]`); v = '[vsp]'; a = '[asp]'; }
  if (tail > 0) { f.push(`${v}tpad=stop_mode=clone:stop_duration=${tail.toFixed(2)}[vt]`); f.push(`${a}apad=pad_dur=${tail.toFixed(2)}[at]`); v = '[vt]'; a = '[at]'; }
  const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  f.push(`${v}ass='${assEsc}'[vass]`); v = '[vass]';
  const args = ['-y', '-hide_banner', '-i', src];
  if (st.brand && logoPath && fs.existsSync(logoPath)) {
    args.push('-i', logoPath);
    const lw = Math.round(W * 0.16);
    const corner = brand.logoPos || 'tr';
    const x = corner.includes('r') ? `W-w-${Math.round(W * 0.04)}` : `${Math.round(W * 0.04)}`;
    const y = corner.includes('b') ? `H-h-${Math.round(Hh * 0.04)}` : `${Math.round(Hh * (extras.badge && !corner.includes('r') ? 0.1 : 0.04))}`;
    f.push(`[1:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=0.9[lg]`);
    f.push(`${v}[lg]overlay=${x}:${y}:enable='lte(t,${mainDur.toFixed(2)})'[vl]`); v = '[vl]';
  }
  args.push('-filter_complex', f.join(';'), '-map', v, '-map', a, '-t', duration.toFixed(2),
    '-c:v', 'libx264', '-preset', process.env.X264_PRESET || 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out);
  await run('ffmpeg', args, (line) => {
    const m = line.match(/time=(\d+):(\d+):([\d.]+)/);
    if (m && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / duration));
  });
  return { duration, cropX };
}

module.exports = { renderClip, buildAss, keptIntervals, run, DEFAULT_SETTINGS, DIMS, FONTS, EMOJI, faceX };
