// IA con la cuenta de Claude del propietario (Claude Code instalado en el servidor).
// Si no esta disponible o falla, el llamador usa las reglas de heuristics.js.
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const H = require('./heuristics');

const BIN = process.env.CLAUDE_BIN || 'claude';
let available = null;

function isAvailable() {
  if (process.env.AI_ENABLED === '0') return false;
  if (available !== null) return available;
  try { execFileSync(BIN, ['--version'], { stdio: 'ignore', timeout: 15000 }); available = true; } catch { available = false; }
  return available;
}

function ask(prompt, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['-p', '--output-format', 'json'], { cwd: os.tmpdir(), env: process.env });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('IA: tiempo agotado')); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return reject(new Error('IA: ' + String(j.result).slice(0, 200)));
        resolve(String(j.result || ''));
      } catch { reject(new Error('IA: respuesta no valida (' + code + ') ' + (err || out).slice(0, 200))); }
    });
    p.stdin.end(prompt);
  });
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text.slice(text.indexOf(text.match(/[\[{]/)?.[0] ?? '{'));
  return JSON.parse(raw.trim());
}

function sentenceList(sents, maxChars = 120000) {
  let s = sents.map((x) => `[${x.k}] (${x.s.toFixed(1)}-${x.e.toFixed(1)}) ${x.text}`).join('\n');
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n[...transcripcion recortada...]';
  return s;
}

async function findClips(words, opts) {
  const sents = H.sentences(words);
  const [minL, maxL] = opts.lengthRange || [25, 60];
  const prompt = `Eres editor experto de video corto (TikTok, Reels, Shorts). Abajo tienes la transcripcion de un video, dividida en frases numeradas con sus tiempos en segundos.
Elige los mejores momentos para clips verticales autonomos. Reglas:
- Cada clip empieza al inicio de una frase y termina al final de otra (usa los numeros de frase).
- Duracion entre ${minL} y ${maxL} segundos. No se solapan.
- Debe entenderse sin contexto, con gancho inicial fuerte y final cerrado.
- Entre ${opts.count || 'el numero adecuado (3 a 15)'} clips.
${opts.from || opts.to ? `- Solo entre los segundos ${opts.from || 0} y ${opts.to || 'final'}.` : ''}
${opts.prompt ? `- El usuario pide especificamente: "${opts.prompt}". Prioriza eso.` : ''}
Puntua cada clip de 0 a 99 en: gancho, ritmo, valor, cierre. Escribe en el idioma del video un titulo atractivo (max 60 caracteres), un gancho corto para poner en pantalla (max 50 caracteres) y una razon breve en español de por que funciona.
Responde SOLO con JSON: {"clips":[{"start":<n frase>,"end":<n frase>,"title":"","hook":"","gancho":0,"ritmo":0,"valor":0,"cierre":0,"reason":""}]}

TRANSCRIPCION:
${sentenceList(sents)}`;
  const j = extractJson(await ask(prompt));
  const out = [];
  for (const c of j.clips || []) {
    const a = sents[c.start], b = sents[c.end];
    if (!a || !b || c.end < c.start) continue;
    const detail = { gancho: +c.gancho || 50, ritmo: +c.ritmo || 50, valor: +c.valor || 50, cierre: +c.cierre || 50 };
    const score = Math.round(detail.gancho * 0.35 + detail.ritmo * 0.2 + detail.valor * 0.3 + detail.cierre * 0.15);
    out.push({ ranges: [[a.s, b.e]], score, detail, reason: c.reason || '', title: (c.title || H.titleFrom(a.text)).slice(0, 80), hook: (c.hook || '').slice(0, 80) });
  }
  if (!out.length) throw new Error('IA sin clips');
  return out.sort((x, y) => y.score - x.score);
}

async function planThreads(words, opts) {
  const sents = H.sentences(words);
  const ranged = opts.from != null && opts.to != null;
  const prompt = `Eres guionista experto en series de video corto. Abajo esta la transcripcion de un video en frases numeradas con tiempos (segundos).
Objetivo: crear ${ranged ? 'UN hilo narrativo con el tramo indicado' : `hasta ${opts.count || 2} hilos narrativos`}. Un hilo es una anecdota o explicacion completa de unos ${opts.target || 180} segundos (entre ${Math.round((opts.target || 180) * 0.75)} y ${Math.round((opts.target || 180) * 1.35)}) dividida en 3 partes secuenciales de duracion parecida.
${ranged ? `El hilo debe usar exactamente el tramo entre los segundos ${opts.from} y ${opts.to}.` : 'Elige bloques con historia completa: planteamiento, nudo y desenlace.'}
Los cortes entre partes deben caer al final de una frase y en el momento de MAXIMO SUSPENSE: justo antes de una revelacion, respuesta, giro o dato clave, nunca despues.
Para cada parte escribe en el idioma del video:
- "title": titulo corto (max 50 caracteres, sin "Parte X").
- "cliffhanger" (solo partes 1 y 2): frase de suspense para mostrar sobre la imagen congelada al final (max 60 caracteres), que genere ganas de ver la siguiente sin revelar nada.
- "recap" (solo partes 2 y 3): resumen de lo anterior en una linea (max 60 caracteres), empezando por "Antes:".
Responde SOLO con JSON: {"threads":[{"title":"","summary":"","parts":[{"start":<n frase>,"end":<n frase>,"title":"","cliffhanger":"","recap":""},{...},{...}]}]}

TRANSCRIPCION:
${sentenceList(sents)}`;
  const j = extractJson(await ask(prompt));
  const out = [];
  for (const t of j.threads || []) {
    if (!t.parts || t.parts.length !== 3) continue;
    const parts = [];
    let ok = true;
    t.parts.forEach((p, i) => {
      const a = sents[p.start], b = sents[p.end];
      if (!a || !b || p.end < p.start) { ok = false; return; }
      const sc = H.scoreBlock(sents.slice(p.start, p.end + 1));
      parts.push({
        ranges: [[a.s, b.e]], title: `${(p.title || t.title || '').slice(0, 60)} (Parte ${i + 1}/3)`, hook: (p.title || '').slice(0, 80),
        cliffhanger: i < 2 ? (p.cliffhanger || H.cliffFor(b.text)).slice(0, 90) : '',
        recap: i > 0 ? (p.recap || '').slice(0, 90) : '', score: sc.score, detail: sc.detail, reason: sc.reason,
      });
    });
    if (ok) out.push({ title: (t.title || parts[0].title).slice(0, 80), summary: (t.summary || '').slice(0, 300), parts });
  }
  if (!out.length) throw new Error('IA sin hilos');
  return out;
}

const NETWORKS = { tiktok: 'TikTok', instagram: 'Instagram Reels', youtube: 'YouTube Shorts', linkedin: 'LinkedIn', x: 'X (Twitter)', facebook: 'Facebook' };

async function postText(clipText, network, extra = '') {
  const prompt = `Escribe el texto de publicacion para ${NETWORKS[network] || network} de este clip de video. Idioma: el del clip. Adapta tono y longitud a la red, incluye 3-5 hashtags relevantes al final${network === 'linkedin' ? ' (pocos hashtags, tono profesional)' : ''}. ${extra}
Responde SOLO con el texto, sin comillas ni explicaciones.

TRANSCRIPCION DEL CLIP:
${clipText.slice(0, 6000)}`;
  return (await ask(prompt, 120000)).trim();
}

function postTextFallback(clipText, network, title, extra = '') {
  const tags = ['#clip', '#viral', '#aprende', '#historia'];
  const base = title || H.titleFrom(clipText);
  return `${base}\n\n${extra ? extra + '\n\n' : ''}${tags.slice(0, network === 'linkedin' ? 2 : 4).join(' ')}`;
}

module.exports = { isAvailable, ask, findClips, planThreads, postText, postTextFallback, NETWORKS };
