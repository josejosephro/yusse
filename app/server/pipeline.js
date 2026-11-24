// Cola de trabajos: importar -> vista previa -> transcribir -> analizar (IA o reglas).
// Y montajes bajo demanda. Todo informa del progreso en directo por websockets.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { db, DATA } = require('./db');
const H = require('./heuristics');
const AI = require('./ai');
const R = require('./render');

let broadcast = () => {};
const setBroadcast = (fn) => (broadcast = fn);

const pdir = (id) => { const d = path.join(DATA, 'projects', String(id)); fs.mkdirSync(d, { recursive: true }); return d; };
const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

// ---------- cola ----------
const queue = [];
let running = null;
function enqueue(job) {
  queue.push(job);
  notifyQueue();
  pump();
}
function notifyQueue() {
  queue.forEach((j, i) => broadcast(j.ws, { type: 'queue', ref: j.ref, position: i + 1 }));
}
async function pump() {
  if (running || !queue.length) return;
  running = queue.shift();
  notifyQueue();
  try { await running.run(); } catch (e) { console.error('[job]', e); }
  running = null;
  setImmediate(pump);
}

// ---------- utilidades ----------
function probe(file) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], (err, out) => {
      if (err) return reject(new Error('No se pudo leer el vídeo'));
      const j = JSON.parse(out);
      const v = (j.streams || []).find((s) => s.codec_type === 'video');
      const a = (j.streams || []).find((s) => s.codec_type === 'audio');
      if (!v) return reject(new Error('El archivo no tiene imagen de vídeo'));
      let w = +v.width, h = +v.height;
      const rot = Math.abs(+(v.tags?.rotate || (v.side_data_list || []).find((x) => x.rotation != null)?.rotation || 0));
      if (rot === 90 || rot === 270) [w, h] = [h, w];
      resolve({ duration: +j.format.duration, width: w, height: h, hasAudio: !!a });
    });
  });
}

function setProject(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE projects SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...fields, id });
  const p = db.prepare('SELECT id, workspace_id, status, step, progress, error, title, duration FROM projects WHERE id=?').get(id);
  if (p) broadcast(p.workspace_id, { type: 'project', project: p });
}

function step(id, stepName, progress) { setProject(id, { status: 'processing', step: stepName, progress: Math.round(progress * 1000) / 1000 }); }

function download(url, out, onP) {
  return new Promise((resolve, reject) => {
    const args = ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4',
      '--no-playlist', '--newline', '--max-filesize', '4G', '-o', out, url];
    const p = spawn(process.env.YTDLP_BIN || 'yt-dlp', args);
    let err = '', title = '';
    const onData = (d) => String(d).split('\n').forEach((l) => {
      const m = l.match(/\[download\]\s+([\d.]+)%/);
      if (m) onP(+m[1] / 100);
      const t = l.match(/\[download\] Destination: (.*)/);
      if (t && !title) title = path.basename(t[1]);
    });
    p.stdout.on('data', onData);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => reject(new Error('El importador de enlaces no está instalado')));
    p.on('close', (c) => (c === 0 && fs.existsSync(out) ? resolve() : reject(new Error(friendlyDl(err)))));
  });
}
function friendlyDl(err) {
  if (/private|Sign in|login/i.test(err)) return 'Ese vídeo es privado o pide iniciar sesión. Prueba con uno público o súbelo como archivo.';
  if (/Unsupported URL/i.test(err)) return 'No reconozco ese enlace. Prueba con YouTube, Vimeo u otro enlace público, o sube el archivo.';
  if (/max-filesize|larger than/i.test(err)) return 'El vídeo es demasiado grande (máx. 4 GB).';
  return 'No se pudo descargar el vídeo del enlace. Puedes subirlo como archivo.';
}

function videoTitle(url) {
  return new Promise((resolve) => {
    execFile(process.env.YTDLP_BIN || 'yt-dlp', ['--get-title', '--no-playlist', url], { timeout: 30000 }, (e, out) => resolve(e ? null : out.trim().split('\n')[0]));
  });
}

async function peaks(src) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', src, '-ac', '1', '-ar', '2000', '-f', 's16le', '-']);
    const out = [];
    let cur = 0, n = 0;
    const per = 200; // 0.1 s
    let carry = null;
    p.stdout.on('data', (buf) => {
      if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
      const len = buf.length - (buf.length % 2);
      if (len < buf.length) carry = buf.subarray(len);
      for (let i = 0; i < len; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > cur) cur = v;
        if (++n === per) { out.push(Math.min(255, Math.round(Math.sqrt(cur / 32768) * 255))); cur = 0; n = 0; }
      }
    });
    p.on('close', () => resolve(out));
    p.on('error', () => resolve([]));
  });
}

function transcribeLocal(audio, duration, language, onP) {
  return new Promise((resolve, reject) => {
    const args = [path.join(__dirname, '..', 'py', 'transcribe.py'), audio, '--model', process.env.WHISPER_MODEL || 'small', '--duration', String(duration)];
    if (language && language !== 'auto') args.push('--language', language);
    const p = spawn(process.env.PYTHON_BIN || 'python3', args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err += d; const m = String(d).match(/PROGRESS ([\d.]+)/g); if (m) onP(+m[m.length - 1].split(' ')[1]); if (err.length > 20000) err = err.slice(-5000); });
    p.on('close', (c) => { if (c !== 0) return reject(new Error('La transcripción falló: ' + err.slice(-300))); try { resolve(JSON.parse(out)); } catch { reject(new Error('Transcripción ilegible')); } });
    p.on('error', () => reject(new Error('El transcriptor no está instalado')));
  });
}

// Alternativa: API externa de transcripcion (solo si se configura TRANSCRIBER=openai)
function transcribeOpenAI(audio, language) {
  return new Promise((resolve, reject) => {
    const args = ['-s', 'https://api.openai.com/v1/audio/transcriptions', '-H', `Authorization: Bearer ${process.env.OPENAI_API_KEY || 'sk-placeholder'}`,
      '-F', `file=@${audio}`, '-F', 'model=whisper-1', '-F', 'response_format=verbose_json', '-F', 'timestamp_granularities[]=word'];
    if (language && language !== 'auto') args.push('-F', `language=${language}`);
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (e, out) => {
      if (e) return reject(new Error('Fallo la transcripcion externa'));
      try {
        const j = JSON.parse(out);
        if (!j.words) return reject(new Error('Transcripcion externa sin palabras: ' + out.slice(0, 200)));
        const words = j.words.map((w) => ({ w: w.word, s: w.start, e: w.end }));
        // reponer puntuacion a partir del texto completo
        const toks = (j.text || '').split(/\s+/).filter(Boolean);
        let k = 0;
        for (const w of words) {
          while (k < toks.length && toks[k].replace(/[^\p{L}\p{N}']/gu, '').toLowerCase() !== w.w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase()) k++;
          if (k < toks.length) { w.w = toks[k]; k++; }
        }
        resolve({ language: j.language, words });
      } catch (err) { reject(new Error('Transcripcion externa ilegible')); }
    });
  });
}

// ---------- analisis ----------
const LENGTHS = { short: [15, 30], mid: [30, 60], long: [60, 90], xl: [90, 180], auto: [20, 75] };

function insertClip(projectId, c, kind = 'auto', threadId = null, partIndex = null, extra = {}) {
  const settings = { ...extra.settings };
  if (threadId) Object.assign(settings, { cliffhanger: c.cliffhanger || '', recap: c.recap || '' });
  const info = db.prepare(`INSERT INTO clips (project_id, kind, thread_id, part_index, title, hook, ranges, score, score_detail, settings)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(projectId, kind, threadId, partIndex, c.title, c.hook || '', JSON.stringify(c.ranges), c.score || 0,
    JSON.stringify({ ...(c.detail || {}), reason: c.reason || '' }), JSON.stringify(settings));
  return info.lastInsertRowid;
}

async function analyze(projectId, words, opts, mode, useAI) {
  let aiUsed = false;
  if (mode === 'thread') {
    const topts = { target: opts.threadLength || 180, from: opts.from ?? null, to: opts.to ?? null, count: opts.threadCount };
    if (topts.from == null || topts.to == null) { delete topts.from; delete topts.to; }
    let threads = null;
    if (useAI && AI.isAvailable()) { try { threads = await AI.planThreads(words, topts); aiUsed = true; } catch (e) { console.warn('[ia hilo]', e.message); } }
    if (!threads) threads = H.threadBlocks(words, topts);
    if (!threads.length) throw new Error('El vídeo es demasiado corto o no tiene suficiente habla para un hilo de 3 partes.');
    db.transaction(() => {
      for (const t of threads) {
        const tid = db.prepare('INSERT INTO threads (project_id, title, summary) VALUES (?,?,?)').run(projectId, t.title, t.summary || '').lastInsertRowid;
        t.parts.forEach((p, i) => insertClip(projectId, p, 'thread', tid, i));
      }
    })();
  } else {
    const copts = { lengthRange: LENGTHS[opts.length] || LENGTHS.auto, prompt: opts.prompt, from: opts.from, to: opts.to, count: opts.count };
    let clips = null;
    if (useAI && AI.isAvailable()) { try { clips = await AI.findClips(words, copts); aiUsed = true; } catch (e) { console.warn('[ia clips]', e.message); } }
    if (!clips) clips = H.autoClips(words, copts);
    if (!clips.length) throw new Error('No encontré momentos con habla suficiente en ese tramo.');
    db.transaction(() => clips.forEach((c) => insertClip(projectId, c)))();
  }
  return aiUsed;
}

function processProject(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  enqueue({
    ws: p.workspace_id, ref: { project: projectId },
    run: async () => {
      const dir = pdir(projectId);
      const src = path.join(dir, 'source.mp4');
      const opts = J(p.options, {});
      try {
        if (p.source_type === 'url' && !fs.existsSync(src)) {
          step(projectId, 'Descargando el vídeo', 0.01);
          const t = await videoTitle(p.source_url);
          if (t) setProject(projectId, { title: t.slice(0, 140) });
          await download(p.source_url, src, (x) => step(projectId, 'Descargando el vídeo', 0.02 + x * 0.2));
        }
        const raw = fs.existsSync(src) ? src : path.join(dir, fs.readdirSync(dir).find((f) => f.startsWith('upload')) || 'x');
        if (!fs.existsSync(raw)) throw new Error('No encuentro el vídeo subido');
        const info = await probe(raw);
        if (!info.hasAudio) throw new Error('El vídeo no tiene sonido: necesito voz para encontrar los momentos.');
        if (info.duration > (+process.env.MAX_MINUTES || 180) * 60) throw new Error(`El vídeo dura más de ${process.env.MAX_MINUTES || 180} minutos.`);
        setProject(projectId, { duration: info.duration, width: info.width, height: info.height });

        step(projectId, 'Preparando la vista previa', 0.23);
        const preview = path.join(dir, 'preview.mp4');
        await R.run('ffmpeg', ['-y', '-hide_banner', '-i', raw, '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
          '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', preview], (l) => {
          const m = l.match(/time=(\d+):(\d+):([\d.]+)/);
          if (m) step(projectId, 'Preparando la vista previa', 0.23 + 0.12 * Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / info.duration));
        });
        await R.run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(5, info.duration / 3)), '-i', preview, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, 'thumb.jpg')]).catch(() => {});

        step(projectId, 'Escuchando y transcribiendo', 0.36);
        const audio = path.join(dir, 'audio.mp3');
        await R.run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
        const pk = await peaks(audio);
        let tr = db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(projectId);
        let words, language;
        if (tr) { words = J(tr.words, []); language = p.language; } else {
          const res = process.env.MOCK_TRANSCRIPT ? JSON.parse(fs.readFileSync(process.env.MOCK_TRANSCRIPT, 'utf8')) : process.env.TRANSCRIBER === 'openai' ? await transcribeOpenAI(audio, opts.language)
            : await transcribeLocal(audio, info.duration, opts.language, (x) => step(projectId, 'Escuchando y transcribiendo', 0.36 + x * 0.42));
          words = res.words; language = res.language;
          db.prepare('INSERT OR REPLACE INTO transcripts (project_id, words, peaks) VALUES (?,?,?)').run(projectId, JSON.stringify(words), JSON.stringify(pk));
        }
        if (words.length < 20) throw new Error('Casi no hay voz en el vídeo: no puedo elegir momentos.');
        setProject(projectId, { language: language || '' });

        const useAI = opts.ai !== false;
        step(projectId, useAI && AI.isAvailable() ? 'La IA está eligiendo los mejores momentos' : 'Eligiendo los mejores momentos', 0.8);
        const aiUsed = await analyze(projectId, words, opts, p.mode, useAI);
        if (raw !== src) fs.renameSync(raw, src);
        fs.rmSync(audio, { force: true });
        setProject(projectId, { status: 'ready', step: 'Listo', progress: 1, ai_used: aiUsed ? 1 : 0, error: null });
      } catch (e) {
        console.error('[proyecto]', projectId, e.message);
        setProject(projectId, { status: 'error', step: 'Error', error: e.message });
      }
    },
  });
}

// ---------- montajes ----------
const renderWaiters = new Map();

function clipRenderKey(clip, brand) {
  return require('crypto').createHash('sha1').update(JSON.stringify([clip.ranges, clip.settings, clip.hook, clip.title, brand, clip.words_rev || 0])).digest('hex').slice(0, 16);
}

function renderExtras(clip, settings, brand) {
  const extras = { hook: settings.showHook === false ? '' : clip.hook };
  if (clip.thread_id != null) {
    const i = clip.part_index;
    extras.badge = `${i + 1}/3`;
    extras.hook = settings.showHook === false ? '' : clip.hook;
    if (i > 0 && settings.recap) extras.recap = settings.recap;
    if (i < 2) {
      if (settings.cliffhanger) extras.cliffhanger = settings.cliffhanger;
      extras.card = { title: settings.ctaTitle || `▶ Parte ${i + 2} en mi perfil`, line: settings.ctaLine || 'Sígueme para no perderte lo que pasa', handle: brand.handle || '' };
    } else if (settings.endCard !== false) {
      extras.card = { title: settings.ctaTitle || 'Fin de la historia', line: settings.ctaLine || '¿Te gustó? Sígueme para más', handle: brand.handle || '' };
    }
  } else if (brand.outro && settings.brand !== false) {
    extras.card = { title: brand.outroTitle || brand.handle || 'Sígueme', line: brand.outroLine || 'Más clips en mi perfil', handle: brand.outroTitle ? brand.handle || '' : '' };
  }
  return extras;
}

function requestRender(clipId) {
  const clip = db.prepare('SELECT c.*, p.workspace_id, p.width, p.height FROM clips c JOIN projects p ON p.id=c.project_id WHERE c.id=?').get(clipId);
  if (!clip) throw new Error('Clip no encontrado');
  const ws = db.prepare('SELECT brand FROM workspaces WHERE id=?').get(clip.workspace_id);
  const brand = J(ws.brand, {});
  const tr = db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(clip.project_id);
  const words = J(tr.words, []);
  const settings = J(clip.settings, {});
  const ranges = J(clip.ranges, []);
  const key = clipRenderKey({ ranges, settings, hook: clip.hook, title: clip.title, words_rev: require('crypto').createHash('sha1').update(tr.words).digest('hex') }, brand);
  const dir = pdir(clip.project_id);
  const out = path.join(dir, `clip-${clipId}-${key}.mp4`);
  if (fs.existsSync(out)) {
    db.prepare("UPDATE clips SET render_status='done', render_key=? WHERE id=?").run(key, clipId);
    broadcast(clip.workspace_id, { type: 'render', clipId, status: 'done', progress: 1, key });
    return Promise.resolve({ file: out, key });
  }
  if (renderWaiters.has(out)) return renderWaiters.get(out);
  db.prepare("UPDATE clips SET render_status='queued' WHERE id=?").run(clipId);
  broadcast(clip.workspace_id, { type: 'render', clipId, status: 'queued', progress: 0 });
  const prom = new Promise((resolve, reject) => {
    enqueue({
      ws: clip.workspace_id, ref: { clip: clipId },
      run: async () => {
        try {
          db.prepare("UPDATE clips SET render_status='rendering' WHERE id=?").run(clipId);
          let last = 0;
          const res = await R.renderClip({
            src: path.join(dir, 'source.mp4'), srcW: clip.width, srcH: clip.height, words, ranges, settings, brand,
            logoPath: brand.logo ? path.join(DATA, 'brand', brand.logo) : null, extras: renderExtras(clip, settings, brand), out,
            onProgress: (x) => { if (x - last > 0.04) { last = x; broadcast(clip.workspace_id, { type: 'render', clipId, status: 'rendering', progress: x }); } },
          });
          if (settings.cropX == null && settings.reframe !== 'fit') {
            settings.cropX = res.cropX;
            db.prepare('UPDATE clips SET settings=? WHERE id=?').run(JSON.stringify(settings), clipId);
          }
          for (const f of fs.readdirSync(dir)) if (f.startsWith(`clip-${clipId}-`) && !f.includes(key)) fs.rmSync(path.join(dir, f), { force: true });
          db.prepare("UPDATE clips SET render_status='done', render_key=? WHERE id=?").run(key, clipId);
          broadcast(clip.workspace_id, { type: 'render', clipId, status: 'done', progress: 1, key });
          resolve({ file: out, key });
        } catch (e) {
          console.error('[montaje]', e.message);
          db.prepare("UPDATE clips SET render_status='error' WHERE id=?").run(clipId);
          broadcast(clip.workspace_id, { type: 'render', clipId, status: 'error', error: 'No se pudo montar el clip' });
          reject(e);
        } finally { renderWaiters.delete(out); }
      },
    });
  });
  prom.catch(() => {});
  renderWaiters.set(out, prom);
  return prom;
}

function resumeOnBoot() {
  for (const p of db.prepare("SELECT id FROM projects WHERE status IN ('queued','processing')").all()) processProject(p.id);
  db.prepare("UPDATE clips SET render_status='none' WHERE render_status IN ('queued','rendering')").run();
}

module.exports = { processProject, requestRender, analyze, setBroadcast, pdir, resumeOnBoot, insertClip, renderExtras, LENGTHS, queueInfo: () => ({ running: !!running, waiting: queue.length }) };
