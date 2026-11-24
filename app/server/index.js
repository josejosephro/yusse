// Yussè Clip — servidor web + tiempo real (websockets)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const archiver = require('archiver');
const { WebSocketServer } = require('ws');
const { db, DATA } = require('./db');
const P = require('./pipeline');
const H = require('./heuristics');
const AI = require('./ai');
const R = require('./render');

const PORT = +process.env.PORT || 3070;
const HOST = process.env.HOST || '127.0.0.1';
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const J = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const token = () => crypto.randomBytes(24).toString('hex');
const code = () => crypto.randomBytes(5).toString('hex');

// ---------- sesiones ----------
function userFrom(req) {
  const t = req.cookies?.ys;
  if (!t) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t) || null;
}
function auth(req, res, next) {
  const u = userFrom(req);
  if (!u) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  req.user = u;
  const m = db.prepare('SELECT * FROM members WHERE workspace_id=? AND user_id=?').get(u.current_ws, u.id);
  if (!m) {
    const any = db.prepare('SELECT workspace_id FROM members WHERE user_id=? LIMIT 1').get(u.id);
    u.current_ws = any?.workspace_id;
    db.prepare('UPDATE users SET current_ws=? WHERE id=?').run(u.current_ws, u.id);
  }
  req.ws = u.current_ws;
  next();
}
function setSession(res, userId) {
  const t = token();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(t, userId);
  res.cookie('ys', t, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 1000 * 3600 * 24 * 60, path: '/' });
}
function createWorkspace(name, ownerId) {
  const id = db.prepare('INSERT INTO workspaces (name, invite_code, owner_id, brand) VALUES (?,?,?,?)')
    .run(name, code(), ownerId, JSON.stringify({ primary: '#FF5A36', accent: '#FFB020', font: 'Montserrat', handle: '', logoPos: 'tr', outro: false })).lastInsertRowid;
  db.prepare("INSERT INTO members (workspace_id, user_id, role) VALUES (?,?,'propietario')").run(id, ownerId);
  return id;
}

app.post('/api/auth/register', (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Escribe un correo válido' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña necesita al menos 6 caracteres' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return res.status(400).json({ error: 'Ese correo ya tiene cuenta. Entra con él.' });
  const uid = db.prepare('INSERT INTO users (email, name, pass) VALUES (?,?,?)').run(email.toLowerCase(), (name || email.split('@')[0]).slice(0, 60), bcrypt.hashSync(password, 10)).lastInsertRowid;
  const ws = createWorkspace(`Espacio de ${(name || email.split('@')[0]).slice(0, 40)}`, uid);
  db.prepare('UPDATE users SET current_ws=? WHERE id=?').run(ws, uid);
  setSession(res, uid);
  res.json({ ok: true });
});
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.pass)) return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
  setSession(res, u.id);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  if (req.cookies?.ys) db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.ys);
  res.clearCookie('ys', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const wss = db.prepare('SELECT w.id, w.name, m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=?').all(req.user.id);
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name }, workspace: req.ws, workspaces: wss, ai: AI.isAvailable(), queue: P.queueInfo() });
});
app.post('/api/workspaces/switch', auth, (req, res) => {
  const m = db.prepare('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?').get(req.body.id, req.user.id);
  if (!m) return res.status(403).json({ error: 'No perteneces a ese espacio' });
  db.prepare('UPDATE users SET current_ws=? WHERE id=?').run(req.body.id, req.user.id);
  res.json({ ok: true });
});
app.post('/api/workspaces', auth, (req, res) => {
  const id = createWorkspace(String(req.body.name || 'Nuevo espacio').slice(0, 60), req.user.id);
  db.prepare('UPDATE users SET current_ws=? WHERE id=?').run(id, req.user.id);
  res.json({ id });
});
app.get('/api/workspace', auth, (req, res) => {
  const w = db.prepare('SELECT id, name, invite_code, owner_id FROM workspaces WHERE id=?').get(req.ws);
  const members = db.prepare('SELECT u.id, u.name, u.email, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?').all(req.ws);
  res.json({ ...w, members, isOwner: w.owner_id === req.user.id });
});
app.patch('/api/workspace', auth, (req, res) => {
  db.prepare('UPDATE workspaces SET name=? WHERE id=?').run(String(req.body.name || '').slice(0, 60) || 'Mi espacio', req.ws);
  res.json({ ok: true });
});
app.post('/api/workspace/invite', auth, (req, res) => {
  const c = code();
  db.prepare('UPDATE workspaces SET invite_code=? WHERE id=? AND owner_id=?').run(c, req.ws, req.user.id);
  res.json({ invite_code: c });
});
app.delete('/api/workspace/members/:uid', auth, (req, res) => {
  const w = db.prepare('SELECT owner_id FROM workspaces WHERE id=?').get(req.ws);
  const self = +req.params.uid === req.user.id;
  if (w.owner_id !== req.user.id && !self) return res.status(403).json({ error: 'Solo el propietario puede quitar miembros' });
  if (+req.params.uid === w.owner_id) return res.status(400).json({ error: 'El propietario no puede salir de su espacio' });
  db.prepare('DELETE FROM members WHERE workspace_id=? AND user_id=?').run(req.ws, req.params.uid);
  res.json({ ok: true });
});
app.post('/api/join/:code', auth, (req, res) => {
  const w = db.prepare('SELECT id, name FROM workspaces WHERE invite_code=?').get(req.params.code);
  if (!w) return res.status(404).json({ error: 'Ese enlace de invitación ya no es válido' });
  db.prepare('INSERT OR IGNORE INTO members (workspace_id, user_id) VALUES (?,?)').run(w.id, req.user.id);
  db.prepare('UPDATE users SET current_ws=? WHERE id=?').run(w.id, req.user.id);
  res.json({ ok: true, name: w.name });
});

// ---------- kit de marca ----------
const brandDir = path.join(DATA, 'brand');
fs.mkdirSync(brandDir, { recursive: true });
app.get('/api/brand', auth, (req, res) => res.json({ ...J(db.prepare('SELECT brand FROM workspaces WHERE id=?').get(req.ws).brand, {}), fonts: R.FONTS }));
app.put('/api/brand', auth, (req, res) => {
  const cur = J(db.prepare('SELECT brand FROM workspaces WHERE id=?').get(req.ws).brand, {});
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);
  const b = req.body || {};
  const next = {
    ...cur, primary: hex(b.primary, cur.primary), accent: hex(b.accent, cur.accent), font: R.FONTS.includes(b.font) ? b.font : cur.font,
    handle: String(b.handle ?? cur.handle ?? '').slice(0, 40), logoPos: ['tl', 'tr', 'bl', 'br'].includes(b.logoPos) ? b.logoPos : cur.logoPos,
    outro: !!b.outro, outroTitle: String(b.outroTitle ?? cur.outroTitle ?? '').slice(0, 50), outroLine: String(b.outroLine ?? cur.outroLine ?? '').slice(0, 70),
    captionStyle: b.captionStyle || cur.captionStyle || 'karaoke',
  };
  db.prepare('UPDATE workspaces SET brand=? WHERE id=?').run(JSON.stringify(next), req.ws);
  res.json(next);
});
const logoUp = multer({ dest: brandDir, limits: { fileSize: 5 * 1024 * 1024 } });
app.post('/api/brand/logo', auth, logoUp.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube una imagen' });
  const name = `logo-${req.ws}-${Date.now()}.png`;
  try {
    await R.run('ffmpeg', ['-y', '-v', 'error', '-i', req.file.path, '-vf', 'scale=600:600:force_original_aspect_ratio=decrease', path.join(brandDir, name)]);
  } catch { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: 'No pude leer esa imagen (usa PNG o JPG)' }); }
  fs.rmSync(req.file.path, { force: true });
  const cur = J(db.prepare('SELECT brand FROM workspaces WHERE id=?').get(req.ws).brand, {});
  if (cur.logo) fs.rmSync(path.join(brandDir, cur.logo), { force: true });
  cur.logo = name;
  db.prepare('UPDATE workspaces SET brand=? WHERE id=?').run(JSON.stringify(cur), req.ws);
  res.json(cur);
});
app.delete('/api/brand/logo', auth, (req, res) => {
  const cur = J(db.prepare('SELECT brand FROM workspaces WHERE id=?').get(req.ws).brand, {});
  if (cur.logo) fs.rmSync(path.join(brandDir, cur.logo), { force: true });
  delete cur.logo;
  db.prepare('UPDATE workspaces SET brand=? WHERE id=?').run(JSON.stringify(cur), req.ws);
  res.json(cur);
});
app.get('/media/brand/logo', auth, (req, res) => {
  const cur = J(db.prepare('SELECT brand FROM workspaces WHERE id=?').get(req.ws).brand, {});
  if (!cur.logo) return res.status(404).end();
  res.sendFile(path.join(brandDir, cur.logo));
});

// ---------- proyectos ----------
function ownProject(req, res) {
  const p = db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').get(req.params.id, req.ws);
  if (!p) { res.status(404).json({ error: 'Proyecto no encontrado' }); return null; }
  return p;
}
const clipOut = (c) => ({ ...c, ranges: J(c.ranges, []), score_detail: J(c.score_detail, {}), settings: { ...R.DEFAULT_SETTINGS, ...J(c.settings, {}) } });

app.get('/api/projects', auth, (req, res) => {
  const rows = db.prepare(`SELECT p.id, p.title, p.mode, p.status, p.step, p.progress, p.error, p.duration, p.created, p.source_type,
      (SELECT COUNT(*) FROM clips c WHERE c.project_id=p.id) AS clips, (SELECT COUNT(*) FROM threads t WHERE t.project_id=p.id) AS threads
      FROM projects p WHERE p.workspace_id=? ORDER BY p.id DESC`).all(req.ws);
  res.json(rows);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => { const d = path.join(DATA, 'incoming'); fs.mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (req, f, cb) => cb(null, token() + path.extname(f.originalname || '').slice(0, 8)),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});
app.post('/api/projects', auth, upload.single('file'), (req, res) => {
  const url = (req.body.url || '').trim();
  if (!req.file && !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'Pega un enlace válido o sube un archivo de vídeo' });
  const mode = req.body.mode === 'thread' ? 'thread' : 'clips';
  const o = J(req.body.options, {});
  const options = {
    length: P.LENGTHS[o.length] ? o.length : 'auto', prompt: String(o.prompt || '').slice(0, 300), language: String(o.language || 'auto').slice(0, 5),
    from: o.from != null && o.from !== '' ? +o.from : undefined, to: o.to != null && o.to !== '' ? +o.to : undefined,
    threadLength: Math.min(300, Math.max(90, +o.threadLength || 180)), ai: o.ai !== false, aspect: o.aspect || '9:16',
  };
  const title = req.file ? (req.file.originalname || 'Vídeo').replace(/\.[^.]+$/, '').slice(0, 140) : url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80);
  const id = db.prepare('INSERT INTO projects (workspace_id, user_id, title, source_type, source_url, mode, options) VALUES (?,?,?,?,?,?,?)')
    .run(req.ws, req.user.id, title, req.file ? 'file' : 'url', req.file ? null : url, mode, JSON.stringify(options)).lastInsertRowid;
  if (req.file) fs.renameSync(req.file.path, path.join(P.pdir(id), 'upload' + path.extname(req.file.filename)));
  P.processProject(id);
  res.json({ id });
});

app.get('/api/projects/:id', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const clips = db.prepare('SELECT * FROM clips WHERE project_id=? ORDER BY thread_id IS NOT NULL, score DESC, id').all(p.id).map(clipOut);
  const threads = db.prepare('SELECT * FROM threads WHERE project_id=? ORDER BY id').all(p.id);
  res.json({ ...p, options: J(p.options, {}), clips, threads });
});
app.delete('/api/projects/:id', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
  fs.rmSync(path.join(DATA, 'projects', String(p.id)), { recursive: true, force: true });
  res.json({ ok: true });
});
app.patch('/api/projects/:id', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  db.prepare('UPDATE projects SET title=? WHERE id=?').run(String(req.body.title || p.title).slice(0, 140), p.id);
  res.json({ ok: true });
});
app.post('/api/projects/:id/retry', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  db.prepare("UPDATE projects SET status='queued', error=NULL, progress=0, step='En cola' WHERE id=?").run(p.id);
  P.processProject(p.id);
  res.json({ ok: true });
});
// Buscar mas momentos / otro modo sobre el mismo video
app.post('/api/projects/:id/analyze', auth, async (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const tr = db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(p.id);
  if (!tr) return res.status(400).json({ error: 'El vídeo aún no está transcrito' });
  const mode = req.body.mode === 'thread' ? 'thread' : 'clips';
  const o = req.body.options || {};
  const opts = { length: o.length || 'auto', prompt: String(o.prompt || '').slice(0, 300), from: o.from ?? undefined, to: o.to ?? undefined, threadLength: +o.threadLength || 180, threadCount: o.from != null ? 1 : undefined };
  try {
    const before = db.prepare('SELECT MAX(id) m FROM clips WHERE project_id=?').get(p.id).m || 0;
    await P.analyze(p.id, J(tr.words, []), opts, mode, o.ai !== false);
    const added = db.prepare('SELECT COUNT(*) n FROM clips WHERE project_id=? AND id>?').get(p.id, before).n;
    res.json({ ok: true, added });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/projects/:id/transcript', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const tr = db.prepare('SELECT words, peaks FROM transcripts WHERE project_id=?').get(p.id);
  if (!tr) return res.json({ words: [], peaks: [], sentences: [] });
  const words = J(tr.words, []);
  res.json({ words, peaks: J(tr.peaks, []), sentences: H.sentences(words).map(({ i0, i1, s, e }) => ({ i0, i1, s, e })) });
});
app.put('/api/projects/:id/transcript/words', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const tr = db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(p.id);
  const words = J(tr.words, []);
  for (const { i, w } of req.body.edits || []) if (words[i] && typeof w === 'string') words[i].w = w.slice(0, 60);
  db.prepare('UPDATE transcripts SET words=? WHERE project_id=?').run(JSON.stringify(words), p.id);
  res.json({ ok: true });
});

// Clip a mano desde la transcripcion
app.post('/api/projects/:id/clips', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const ranges = (req.body.ranges || []).filter((r) => r[1] > r[0]).map((r) => [Math.max(0, +r[0]), Math.min(p.duration, +r[1])]);
  if (!ranges.length) return res.status(400).json({ error: 'Selecciona un tramo de la transcripción' });
  const words = J(db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(p.id).words, []);
  const ws = words.filter((w) => ranges.some(([s, e]) => w.s >= s && w.e <= e));
  const sents = H.sentences(ws.length ? ws : words.slice(0, 5));
  const sc = H.scoreBlock(sents);
  const id = P.insertClip(p.id, { ranges, title: req.body.title || H.titleFrom(ws.map((w) => w.w).join(' ')), hook: '', score: sc.score, detail: sc.detail, reason: 'Elegido a mano' }, req.body.kind === 'merge' ? 'merge' : 'manual');
  res.json(clipOut(db.prepare('SELECT * FROM clips WHERE id=?').get(id)));
});
app.post('/api/projects/:id/merge', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const ids = (req.body.clipIds || []).map(Number);
  const cl = ids.map((i) => db.prepare('SELECT * FROM clips WHERE id=? AND project_id=?').get(i, p.id)).filter(Boolean);
  if (cl.length < 2) return res.status(400).json({ error: 'Elige al menos dos clips para unir' });
  const ranges = cl.flatMap((c) => J(c.ranges, []));
  const score = Math.round(cl.reduce((a, c) => a + c.score, 0) / cl.length);
  const id = P.insertClip(p.id, { ranges, title: 'Unión: ' + cl.map((c) => c.title).join(' + ').slice(0, 70), hook: cl[0].hook, score, detail: J(cl[0].score_detail, {}), reason: `Une ${cl.length} clips` }, 'merge', null, null, { settings: J(cl[0].settings, {}) });
  res.json(clipOut(db.prepare('SELECT * FROM clips WHERE id=?').get(id)));
});
app.post('/api/projects/:id/threads', auth, async (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const tr = db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(p.id);
  const from = +req.body.from, to = +req.body.to;
  if (!(to - from >= 45)) return res.status(400).json({ error: 'Selecciona al menos 45 segundos para dividir en 3 partes' });
  try {
    await P.analyze(p.id, J(tr.words, []), { from, to, threadLength: to - from, threadCount: 1 }, 'thread', req.body.ai !== false);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------- clips ----------
function ownClip(req, res) {
  const c = db.prepare('SELECT c.* FROM clips c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.workspace_id=?').get(req.params.id, req.ws);
  if (!c) { res.status(404).json({ error: 'Clip no encontrado' }); return null; }
  return c;
}
const snapshot = (c) => JSON.stringify({ title: c.title, hook: c.hook, ranges: J(c.ranges, []), settings: J(c.settings, {}), post_text: c.post_text });

app.get('/api/clips/:id', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const thread = c.thread_id ? db.prepare('SELECT * FROM threads WHERE id=?').get(c.thread_id) : null;
  res.json({ ...clipOut(c), thread });
});
app.patch('/api/clips/:id', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const b = req.body || {};
  const last = db.prepare('SELECT created FROM clip_versions WHERE clip_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  if (!last || Date.now() / 1000 - last.created > 45 || b.label) {
    db.prepare('INSERT INTO clip_versions (clip_id, data, label) VALUES (?,?,?)').run(c.id, snapshot(c), b.label || 'Autoguardado');
    db.prepare('DELETE FROM clip_versions WHERE clip_id=? AND id NOT IN (SELECT id FROM clip_versions WHERE clip_id=? ORDER BY id DESC LIMIT 40)').run(c.id, c.id);
  }
  const p = db.prepare('SELECT duration FROM projects WHERE id=?').get(c.project_id);
  const next = {
    title: b.title != null ? String(b.title).slice(0, 120) : c.title,
    hook: b.hook != null ? String(b.hook).slice(0, 100) : c.hook,
    post_text: b.post_text != null ? String(b.post_text).slice(0, 3000) : c.post_text,
    ranges: Array.isArray(b.ranges) ? JSON.stringify(b.ranges.map((r) => [Math.max(0, +r[0]), Math.min(p.duration, +r[1])]).filter((r) => r[1] - r[0] > 0.2)) : c.ranges,
    settings: b.settings ? JSON.stringify({ ...J(c.settings, {}), ...b.settings }) : c.settings,
  };
  if (!J(next.ranges, []).length) return res.status(400).json({ error: 'El clip necesita al menos un tramo' });
  db.prepare("UPDATE clips SET title=@title, hook=@hook, post_text=@post_text, ranges=@ranges, settings=@settings, updated=unixepoch(), render_status='none' WHERE id=@id").run({ ...next, id: c.id });
  res.json(clipOut(db.prepare('SELECT * FROM clips WHERE id=?').get(c.id)));
});
app.get('/api/clips/:id/versions', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  res.json(db.prepare('SELECT id, label, created FROM clip_versions WHERE clip_id=? ORDER BY id DESC').all(c.id));
});
app.post('/api/clips/:id/versions/:vid/restore', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const v = db.prepare('SELECT * FROM clip_versions WHERE id=? AND clip_id=?').get(req.params.vid, c.id);
  if (!v) return res.status(404).json({ error: 'Versión no encontrada' });
  db.prepare('INSERT INTO clip_versions (clip_id, data, label) VALUES (?,?,?)').run(c.id, snapshot(c), 'Antes de restaurar');
  const d = J(v.data, {});
  db.prepare("UPDATE clips SET title=?, hook=?, ranges=?, settings=?, post_text=?, render_status='none', updated=unixepoch() WHERE id=?")
    .run(d.title, d.hook, JSON.stringify(d.ranges), JSON.stringify(d.settings), d.post_text || '', c.id);
  res.json(clipOut(db.prepare('SELECT * FROM clips WHERE id=?').get(c.id)));
});
app.post('/api/clips/:id/duplicate', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const id = db.prepare(`INSERT INTO clips (project_id, kind, title, hook, ranges, score, score_detail, settings, post_text)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(c.project_id, 'manual', c.title + ' (copia)', c.hook, c.ranges, c.score, c.score_detail, c.settings, c.post_text).lastInsertRowid;
  res.json({ id });
});
app.delete('/api/clips/:id', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  if (c.thread_id) return res.status(400).json({ error: 'Las partes de un hilo se borran borrando el hilo completo' });
  db.prepare('DELETE FROM clips WHERE id=?').run(c.id);
  res.json({ ok: true });
});
app.post('/api/clips/:id/render', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  P.requestRender(c.id).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/clips/:id/post-text', auth, async (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const words = J(db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(c.project_id).words, []);
  const ranges = J(c.ranges, []);
  const text = words.filter((w) => ranges.some(([s, e]) => w.s >= s && w.e <= e)).map((w) => w.w).join(' ');
  const network = String(req.body.network || 'tiktok');
  let extra = '';
  if (c.thread_id) extra = `Es la parte ${c.part_index + 1} de 3 de una serie. ${c.part_index < 2 ? `Termina invitando a ver la parte ${c.part_index + 2} en el perfil.` : 'Es el final de la serie.'}`;
  let out, ai = false;
  if (AI.isAvailable()) { try { out = await AI.postText(text, network, extra); ai = true; } catch (e) { console.warn('[ia post]', e.message); } }
  if (!out) out = AI.postTextFallback(text, network, c.title, c.thread_id ? `Parte ${c.part_index + 1}/3${c.part_index < 2 ? ' · la siguiente, en mi perfil 👉' : ''}` : '');
  db.prepare('UPDATE clips SET post_text=? WHERE id=?').run(out, c.id);
  res.json({ text: out, ai });
});

// ---------- hilos ----------
function ownThread(req, res) {
  const t = db.prepare('SELECT t.* FROM threads t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.workspace_id=?').get(req.params.id, req.ws);
  if (!t) { res.status(404).json({ error: 'Hilo no encontrado' }); return null; }
  return t;
}
app.patch('/api/threads/:id', auth, (req, res) => {
  const t = ownThread(req, res); if (!t) return;
  db.prepare('UPDATE threads SET title=? WHERE id=?').run(String(req.body.title || t.title).slice(0, 100), t.id);
  res.json({ ok: true });
});
app.delete('/api/threads/:id', auth, (req, res) => {
  const t = ownThread(req, res); if (!t) return;
  db.prepare('DELETE FROM threads WHERE id=?').run(t.id);
  res.json({ ok: true });
});
// mover un corte entre partes una frase adelante o atras
app.post('/api/threads/:id/cut', auth, (req, res) => {
  const t = ownThread(req, res); if (!t) return;
  const parts = db.prepare('SELECT * FROM clips WHERE thread_id=? ORDER BY part_index').all(t.id);
  const cut = +req.body.cut, delta = +req.body.delta > 0 ? 1 : -1;
  if (![0, 1].includes(cut) || parts.length !== 3) return res.status(400).json({ error: 'Corte no válido' });
  const words = J(db.prepare('SELECT words FROM transcripts WHERE project_id=?').get(t.project_id).words, []);
  const sents = H.sentences(words);
  const A = J(parts[cut].ranges, []), B = J(parts[cut + 1].ranges, []);
  const cutT = A[A.length - 1][1];
  const k = sents.findIndex((s) => Math.abs(s.e - cutT) < 0.05) >= 0 ? sents.findIndex((s) => Math.abs(s.e - cutT) < 0.05) : sents.findIndex((s) => s.e >= cutT);
  const nk = k + delta;
  if (!sents[nk] || sents[nk].e <= A[0][0] + 5 || sents[nk].e >= B[B.length - 1][1] - 5) return res.status(400).json({ error: 'No se puede mover más ese corte' });
  A[A.length - 1][1] = sents[nk].e;
  B[0][0] = sents[nk + 1].s;
  const up = db.prepare("UPDATE clips SET ranges=?, render_status='none' WHERE id=?");
  up.run(JSON.stringify(A), parts[cut].id); up.run(JSON.stringify(B), parts[cut + 1].id);
  const st = J(parts[cut].settings, {});
  st.cliffhanger = st.cliffhangerEdited ? st.cliffhanger : H.cliffFor(sents[nk].text);
  db.prepare('UPDATE clips SET settings=? WHERE id=?').run(JSON.stringify(st), parts[cut].id);
  res.json({ ok: true });
});
app.post('/api/threads/:id/schedule', auth, (req, res) => {
  const t = ownThread(req, res); if (!t) return;
  const parts = db.prepare('SELECT * FROM clips WHERE thread_id=? ORDER BY part_index').all(t.id);
  const start = +req.body.start || Math.floor(Date.now() / 1000) + 3600;
  const gap = (+req.body.gapHours || 24) * 3600;
  const nets = (req.body.networks || ['tiktok']).slice(0, 6);
  const ins = db.prepare('INSERT INTO posts (workspace_id, clip_id, network, at, text) VALUES (?,?,?,?,?)');
  parts.forEach((c, i) => nets.forEach((n) => ins.run(req.ws, c.id, n, start + i * gap, c.post_text || `${c.title}${i < 2 ? ' · Parte ' + (i + 2) + ' en mi perfil 👉' : ''}`)));
  res.json({ ok: true, count: parts.length * nets.length });
});

// ---------- calendario ----------
app.get('/api/posts', auth, (req, res) => {
  const from = +req.query.from || 0, to = +req.query.to || 4e9;
  res.json(db.prepare(`SELECT po.*, c.title clip_title, c.project_id, c.thread_id, c.part_index FROM posts po JOIN clips c ON c.id=po.clip_id
    WHERE po.workspace_id=? AND po.at BETWEEN ? AND ? ORDER BY po.at`).all(req.ws, from, to));
});
app.post('/api/posts', auth, (req, res) => {
  const c = db.prepare('SELECT c.* FROM clips c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND p.workspace_id=?').get(req.body.clip_id, req.ws);
  if (!c) return res.status(404).json({ error: 'Clip no encontrado' });
  const id = db.prepare('INSERT INTO posts (workspace_id, clip_id, network, at, text) VALUES (?,?,?,?,?)')
    .run(req.ws, c.id, String(req.body.network || 'tiktok'), +req.body.at || Math.floor(Date.now() / 1000), String(req.body.text ?? c.post_text ?? '').slice(0, 3000)).lastInsertRowid;
  res.json({ id });
});
app.patch('/api/posts/:id', auth, (req, res) => {
  const po = db.prepare('SELECT * FROM posts WHERE id=? AND workspace_id=?').get(req.params.id, req.ws);
  if (!po) return res.status(404).json({ error: 'Publicación no encontrada' });
  const b = req.body;
  db.prepare('UPDATE posts SET network=?, at=?, text=?, status=? WHERE id=?').run(b.network || po.network, +b.at || po.at, b.text ?? po.text, b.status || po.status, po.id);
  res.json({ ok: true });
});
app.delete('/api/posts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM posts WHERE id=? AND workspace_id=?').run(req.params.id, req.ws);
  res.json({ ok: true });
});

// ---------- archivos ----------
const safeName = (s) => String(s || 'clip').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60).replace(/\s+/g, '-') || 'clip';
app.get('/media/p/:id/:file', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  if (!['preview.mp4', 'thumb.jpg'].includes(req.params.file)) return res.status(404).end();
  const f = path.join(DATA, 'projects', String(p.id), req.params.file);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f, { maxAge: '1h' });
});
app.get('/media/clip/:id', auth, (req, res) => {
  const c = ownClip(req, res); if (!c) return;
  const f = path.join(DATA, 'projects', String(c.project_id), `clip-${c.id}-${c.render_key}.mp4`);
  if (c.render_status !== 'done' || !fs.existsSync(f)) return res.status(409).json({ error: 'El clip aún no está montado' });
  if (req.query.dl) res.download(f, `${safeName(c.title)}.mp4`); else res.sendFile(f);
});
app.post('/api/projects/:id/render-all', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const ids = (req.body.clipIds?.length ? req.body.clipIds : db.prepare('SELECT id FROM clips WHERE project_id=?').all(p.id).map((r) => r.id)).map(Number);
  ids.forEach((id) => P.requestRender(id).catch(() => {}));
  res.json({ ok: true, count: ids.length });
});
app.get('/media/p/:id/zip', auth, (req, res) => {
  const p = ownProject(req, res); if (!p) return;
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const rows = db.prepare("SELECT * FROM clips WHERE project_id=? AND render_status='done'").all(p.id).filter((c) => !ids.length || ids.includes(c.id));
  if (!rows.length) return res.status(409).json({ error: 'Todavía no hay clips montados' });
  res.attachment(`${safeName(p.title)}-clips.zip`);
  const z = archiver('zip', { store: true });
  z.pipe(res);
  rows.forEach((c, i) => {
    const f = path.join(DATA, 'projects', String(p.id), `clip-${c.id}-${c.render_key}.mp4`);
    const nm = c.thread_id ? `hilo-${c.thread_id}-parte-${c.part_index + 1}-${safeName(c.title)}.mp4` : `${String(i + 1).padStart(2, '0')}-${safeName(c.title)}.mp4`;
    if (fs.existsSync(f)) z.file(f, { name: nm });
  });
  z.finalize();
});

app.get('/api/health', (req, res) => res.json({ ok: true, ai: AI.isAvailable(), queue: P.queueInfo() }));

// ---------- web ----------
app.use('/fonts', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '5m' }));
app.use((err, req, res, next) => {
  console.error('[http]', err.message);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande' : 'Algo salió mal. Inténtalo de nuevo.' });
});

// ---------- tiempo real ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const sockets = new Set();
server.on('upgrade', (req, socket, head) => {
  if (!req.url.endsWith('/ws') && !req.url.includes('/ws?')) return socket.destroy();
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)));
  const u = cookies.ys && db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(cookies.ys);
  if (!u) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.userId = u.id; sockets.add(ws); ws.on('close', () => sockets.delete(ws)); ws.send(JSON.stringify({ type: 'hello' })); });
});
P.setBroadcast((wsId, msg) => {
  const s = JSON.stringify(msg);
  const members = new Set(db.prepare('SELECT user_id FROM members WHERE workspace_id=?').all(wsId).map((r) => r.user_id));
  for (const ws of sockets) if (members.has(ws.userId) && ws.readyState === 1) ws.send(s);
});
setInterval(() => { for (const ws of sockets) if (ws.readyState === 1) ws.ping(); }, 25000);

server.listen(PORT, HOST, () => {
  console.log(`Yussè Clip escuchando en http://${HOST}:${PORT}  · IA: ${AI.isAvailable() ? 'sí' : 'no'}`);
  P.resumeOnBoot();
});
