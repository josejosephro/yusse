const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new Database(path.join(DATA, 'yusse.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, pass TEXT NOT NULL,
  current_ws INTEGER, created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY, name TEXT, invite_code TEXT UNIQUE, owner_id INTEGER,
  brand TEXT DEFAULT '{}', created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS members (
  workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, role TEXT DEFAULT 'miembro',
  PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER, title TEXT, source_type TEXT, source_url TEXT, mode TEXT DEFAULT 'clips',
  options TEXT DEFAULT '{}', status TEXT DEFAULT 'queued', step TEXT, progress REAL DEFAULT 0,
  error TEXT, duration REAL, width INTEGER, height INTEGER, language TEXT, ai_used INTEGER DEFAULT 0,
  created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS transcripts (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  words TEXT, peaks TEXT);
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT, summary TEXT, created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'auto', thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
  part_index INTEGER, title TEXT, hook TEXT, ranges TEXT, score INTEGER DEFAULT 0,
  score_detail TEXT DEFAULT '{}', settings TEXT DEFAULT '{}', post_text TEXT DEFAULT '',
  render_status TEXT DEFAULT 'none', render_key TEXT,
  created INTEGER DEFAULT (unixepoch()), updated INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS clip_versions (
  id INTEGER PRIMARY KEY, clip_id INTEGER REFERENCES clips(id) ON DELETE CASCADE,
  data TEXT, label TEXT, created INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY, workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
  clip_id INTEGER REFERENCES clips(id) ON DELETE CASCADE, network TEXT, at INTEGER,
  text TEXT, status TEXT DEFAULT 'planificado', created INTEGER DEFAULT (unixepoch()));
`);

module.exports = { db, DATA };
