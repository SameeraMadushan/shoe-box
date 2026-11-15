// ADR section 5 schema, plus chats.member_count (needed for the group meta line).
export default `
CREATE TABLE backup_runs (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  trigger TEXT NOT NULL,              -- first|scheduled|wake|manual|retry
  transport TEXT,                     -- usb|wifi
  status TEXT NOT NULL,               -- running|succeeded|failed
  error_code TEXT,
  new_messages INTEGER DEFAULT 0, new_media INTEGER DEFAULT 0,
  drive_status TEXT                   -- off|synced|failed
);
CREATE TABLE chats (
  id INTEGER PRIMARY KEY,
  jid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER,
  last_message_at INTEGER,
  first_message_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  source_id TEXT NOT NULL,            -- ZSTANZAID
  from_me INTEGER NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  sent_at INTEGER NOT NULL,           -- unix seconds
  kind TEXT NOT NULL,                 -- text|image|video|voice|audio|document|other
  text TEXT,
  first_seen_run INTEGER NOT NULL REFERENCES backup_runs(id),
  last_seen_run INTEGER NOT NULL REFERENCES backup_runs(id),
  deleted_on_phone_at INTEGER,
  UNIQUE (chat_id, source_id, from_me)
);
CREATE INDEX messages_chat_time ON messages(chat_id, sent_at);
CREATE INDEX messages_last_seen ON messages(last_seen_run);
CREATE TABLE message_revisions (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  text TEXT, replaced_at INTEGER NOT NULL
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
  rel_path TEXT,                      -- under archive/media, NULL if not on phone
  mime TEXT, size_bytes INTEGER, duration_s REAL,
  file_name TEXT, caption TEXT
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id');
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
`;
