// Analisis sin IA: frases, puntuacion de momentos y division en hilo narrativo.
// Tambien sirve de red de seguridad cuando la IA no responde.

const FILLERS = new Set(['eh', 'ehh', 'em', 'emm', 'mm', 'mmm', 'este', 'osea', 'o sea', 'pues', 'um', 'uh', 'uhm', 'erm', 'hmm', 'ah', 'like', 'bueno']);
const STRICT_FILLERS = new Set(['eh', 'ehh', 'em', 'emm', 'mm', 'mmm', 'um', 'uh', 'uhm', 'erm', 'hmm']);

const HOOK = /\b(secreto|nunca|nadie|error|errores|verdad|cómo|como|por qué|porque|increíble|truco|clave|problema|mejor|peor|jamás|imagina|atención|ojo|mira|sabías|never|secret|mistake|how|why|truth|best|worst|imagine)\b/i;
const VALUE = /\b(paso|pasos|consejo|regla|dato|aprende|aprendí|resultado|porcentaje|dinero|tiempo|método|estrategia|idea|lección|importante|tip|step|lesson|result|money|strategy)\b|\d/i;
const NARRATIVE = /\b(entonces|de repente|resulta que|un día|cuando|hasta que|al final|después|luego|me dijo|le dije|y ahí|so|then|suddenly|one day|until|finally)\b/i;
const TENSION = /\b(pero|sin embargo|y entonces|de repente|hasta que|cuando|y ahí|lo que pasó|adivina|but|then|suddenly|until|guess what)\b/i;

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim();
const isFiller = (w, strict = true) => (strict ? STRICT_FILLERS : FILLERS).has(norm(w));

function sentences(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    if (!cur) cur = { i0: i, i1: i, s: w.s, e: w.e, text: '' };
    cur.i1 = i; cur.e = w.e;
    cur.text += (cur.text ? ' ' : '') + w.w;
    const next = words[i + 1];
    const gap = next ? next.s - w.e : 99;
    const punct = /[.!?¿¡…]$/.test(w.w);
    if (punct || gap > 0.8 || cur.i1 - cur.i0 > 40) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out.map((s, k) => ({ ...s, k }));
}

function scoreBlock(sents) {
  const text = sents.map((s) => s.text).join(' ');
  const dur = sents[sents.length - 1].e - sents[0].s;
  const nWords = text.split(/\s+/).length;
  const wps = nWords / Math.max(1, dur);
  const first = sents[0].text;
  const last = sents[sents.length - 1].text;
  let hook = 45 + (HOOK.test(first) ? 30 : 0) + (/\?/.test(first) ? 15 : 0) + (first.split(' ').length < 14 ? 8 : 0);
  let flow = 100 - Math.min(60, Math.abs(wps - 2.7) * 35);
  const gaps = sents.slice(1).map((s, i) => s.s - sents[i].e).filter((g) => g > 1.2).length;
  flow -= gaps * 6;
  const vm = (text.match(new RegExp(VALUE, 'gi')) || []).length;
  let value = 40 + Math.min(50, vm * 8) + (NARRATIVE.test(text) ? 8 : 0);
  let close = /[.!]$/.test(last) ? 80 : 55;
  if (/\?$/.test(last)) close = 65;
  const c = (v) => Math.max(5, Math.min(99, Math.round(v)));
  const detail = { gancho: c(hook), ritmo: c(flow), valor: c(value), cierre: c(close) };
  const score = c(detail.gancho * 0.35 + detail.ritmo * 0.2 + detail.valor * 0.3 + detail.cierre * 0.15);
  const reasons = [];
  if (detail.gancho > 70) reasons.push('arranca con un gancho fuerte');
  if (detail.valor > 70) reasons.push('aporta datos o consejos concretos');
  if (detail.ritmo > 75) reasons.push('ritmo de voz ágil');
  if (detail.cierre > 70) reasons.push('termina con una idea cerrada');
  if (!reasons.length) reasons.push('momento coherente y bien delimitado');
  return { score, detail, reason: reasons.join(', ') };
}

function shortHook(text, max = 55) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:]+$/, '') + '…';
}

function titleFrom(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const words = t.split(' ').slice(0, 9).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1).replace(/[,.;:]+$/, '') + (t.split(' ').length > 9 ? '…' : '');
}

function autoClips(words, opts = {}) {
  const sents = sentences(words);
  if (!sents.length) return [];
  const [minL, maxL] = opts.lengthRange || [25, 60];
  const from = opts.from || 0, to = opts.to || Infinity;
  const kw = (opts.prompt || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
  const cands = [];
  for (let a = 0; a < sents.length; a++) {
    if (sents[a].s < from) continue;
    for (let b = a; b < sents.length; b++) {
      if (sents[b].e > to) break;
      const d = sents[b].e - sents[a].s;
      if (d > maxL) break;
      if (d < minL) continue;
      const block = sents.slice(a, b + 1);
      const sc = scoreBlock(block);
      if (kw.length) {
        const txt = block.map((s) => s.text).join(' ').toLowerCase();
        const hits = kw.filter((k) => txt.includes(k)).length;
        sc.score = Math.min(99, sc.score + hits * 12);
      }
      cands.push({ a, b, ...sc });
    }
  }
  cands.sort((x, y) => y.score - x.score);
  const picked = [];
  const maxN = opts.count || Math.max(3, Math.min(20, Math.round((words[words.length - 1].e) / 60 / 1.5) + 2));
  for (const c of cands) {
    if (picked.length >= maxN) break;
    if (picked.some((p) => !(c.b < p.a || c.a > p.b))) continue;
    picked.push(c);
  }
  return picked.map((c) => {
    const block = sents.slice(c.a, c.b + 1);
    return {
      ranges: [[sents[c.a].s, sents[c.b].e]], score: c.score, detail: c.detail, reason: c.reason,
      title: titleFrom(block[0].text), hook: shortHook(block[0].text),
    };
  });
}

// Busca el mejor bloque narrativo (~2.5-4 min) y lo corta en 3 partes con suspense.
function threadBlocks(words, opts = {}) {
  const sents = sentences(words);
  if (sents.length < 6) return [];
  const target = opts.target || 180;
  const lo = target * 0.75, hi = target * 1.35;
  const from = opts.from ?? 0, to = opts.to ?? Infinity;
  const total = words[words.length - 1].e;
  const res = [];
  if (opts.from != null && opts.to != null) {
    const a = sents.findIndex((s) => s.e > from);
    let b = sents.length - 1;
    while (b > a && sents[b].s >= to) b--;
    if (a >= 0 && b > a + 2) res.push(splitThread(sents, a, b));
    return res;
  }
  let best = [];
  for (let a = 0; a < sents.length; a++) {
    for (let b = a + 3; b < sents.length; b++) {
      const d = sents[b].e - sents[a].s;
      if (d > hi) break;
      if (d < Math.min(lo, total * 0.8)) continue;
      const txt = sents.slice(a, b + 1).map((s) => s.text).join(' ');
      const story = (txt.match(new RegExp(NARRATIVE, 'gi')) || []).length * 6 + (txt.match(new RegExp(TENSION, 'gi')) || []).length * 4
        + (HOOK.test(sents[a].text) ? 15 : 0) - Math.abs(d - target) / 6;
      best.push({ a, b, story });
    }
  }
  best.sort((x, y) => y.story - x.story);
  const picked = [];
  const n = opts.count || Math.max(1, Math.min(3, Math.floor(total / 400) + 1));
  for (const c of best) {
    if (picked.length >= n) break;
    if (picked.some((p) => !(c.b < p.a || c.a > p.b))) continue;
    picked.push(c);
  }
  return picked.map((c) => splitThread(sents, c.a, c.b));
}

function tensionAt(sents, k) {
  // tension del corte justo despues de la frase k
  const s = sents[k], n = sents[k + 1];
  let t = 0;
  if (/\?$/.test(s.text)) t += 30;
  if (/…$|\.\.\.$/.test(s.text)) t += 20;
  if (TENSION.test(s.text.split(' ').slice(-6).join(' '))) t += 25;
  if (n && TENSION.test(n.text.split(' ').slice(0, 4).join(' '))) t += 15;
  if (n && /\b(y|pero|entonces|así que|resulta)\b/i.test(n.text.split(' ')[0] || '')) t += 10;
  return t;
}

function cliffFor(text) {
  const t = text.toLowerCase();
  if (/\?$/.test(text)) return '¿La respuesta? No te la vas a creer…';
  if (/\b(dijo|respondió|contestó|said)\b/.test(t)) return 'Lo que dijo después lo cambió todo…';
  if (/\b(pero|but)\b/.test(t)) return 'Pero entonces pasó algo que nadie esperaba…';
  if (/\b(paso|step|truco|clave)\b/.test(t)) return 'El paso que falta es el más importante…';
  return 'Y justo ahí empezó lo bueno…';
}

function splitThread(sents, a, b) {
  const total = sents[b].e - sents[a].s;
  const cuts = [];
  let startK = a;
  for (const frac of [1 / 3, 2 / 3]) {
    const ideal = sents[a].s + total * frac;
    let bestK = null, bestV = -1e9;
    for (let k = startK + 1; k < b - 1; k++) {
      const dev = Math.abs(sents[k].e - ideal) / total;
      if (dev > 0.14) continue;
      const v = tensionAt(sents, k) - dev * 250;
      if (v > bestV) { bestV = v; bestK = k; }
    }
    if (bestK == null) {
      bestK = startK + 1;
      for (let k = startK + 1; k < b - 1; k++) if (Math.abs(sents[k].e - ideal) < Math.abs(sents[bestK].e - ideal)) bestK = k;
    }
    cuts.push(bestK); startK = bestK;
  }
  const bounds = [[a, cuts[0]], [cuts[0] + 1, cuts[1]], [cuts[1] + 1, b]];
  const title = titleFrom(sents[a].text);
  return {
    title,
    summary: sents.slice(a, b + 1).map((s) => s.text).join(' ').slice(0, 220),
    parts: bounds.map(([x, y], i) => {
      const block = sents.slice(x, y + 1);
      const sc = scoreBlock(block);
      return {
        ranges: [[sents[x].s, sents[y].e]],
        title: `${title} (Parte ${i + 1}/3)`,
        hook: shortHook(block[0].text),
        cliffhanger: i < 2 ? cliffFor(sents[y].text) : '',
        recap: i > 0 ? 'Antes: ' + titleFrom(sents[bounds[i - 1][0]].text) : '',
        score: sc.score, detail: sc.detail, reason: sc.reason,
      };
    }),
  };
}

module.exports = { shortHook, sentences, autoClips, threadBlocks, splitThread, scoreBlock, titleFrom, isFiller, cliffFor };
