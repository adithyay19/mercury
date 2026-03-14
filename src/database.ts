import type { Database } from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import path from 'path';

const dbPath = import.meta.dirname + '/stats.db';
export const db: Database = new BetterSqlite3(dbPath);
// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS voice_sessions (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    join_time INTEGER NOT NULL,
    leave_time INTEGER,
    duration INTEGER,           -- seconds, calculated on leave
    PRIMARY KEY (user_id, guild_id, join_time)
  );

  CREATE TABLE IF NOT EXISTS activity_sessions (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    activity_name TEXT NOT NULL,
    activity_type TEXT,         -- PLAYING, WATCHING, etc.
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER,
    PRIMARY KEY (user_id, guild_id, activity_name, start_time)
  );

  CREATE TABLE IF NOT EXISTS totals (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,         -- 'voice' or 'activity:<name>'
    total_seconds INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id, type)
  );
`);

export function startVoiceSession(userId: string, guildId: string, timestamp: number = Date.now()) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO voice_sessions (user_id, guild_id, join_time)
    VALUES (?, ?, ?)
  `);
  stmt.run(userId, guildId, timestamp);
}

export function endVoiceSession(userId: string, guildId: string, timestamp: number = Date.now()) {
  const session = db.prepare(`
    SELECT join_time FROM voice_sessions
    WHERE user_id = ? AND guild_id = ? AND leave_time IS NULL
    ORDER BY join_time DESC LIMIT 1
  `).get(userId, guildId) as { join_time: number } | undefined;

  if (!session) return;

  const duration = Math.floor((timestamp - session.join_time) / 1000);

  db.prepare(`
    UPDATE voice_sessions
    SET leave_time = ?, duration = ?
    WHERE user_id = ? AND guild_id = ? AND join_time = ?
  `).run(timestamp, duration, userId, guildId, session.join_time);

  // Update total
  db.prepare(`
    INSERT INTO totals (user_id, guild_id, type, total_seconds)
    VALUES (?, ?, 'voice', ?)
    ON CONFLICT(user_id, guild_id, type)
    DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds
  `).run(userId, guildId, duration);
}

export function startActivitySession(
  userId: string,
  guildId: string,
  name: string,
  type: string,
  timestamp: number = Date.now()
) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO activity_sessions (user_id, guild_id, activity_name, activity_type, start_time)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(userId, guildId, name, type, timestamp);
}

export function endActivitySession(
  userId: string,
  guildId: string,
  name: string,
  timestamp: number = Date.now()
) {
  const session = db.prepare(`
    SELECT start_time FROM activity_sessions
    WHERE user_id = ? AND guild_id = ? AND activity_name = ? AND end_time IS NULL
    ORDER BY start_time DESC LIMIT 1
  `).get(userId, guildId, name) as { start_time: number } | undefined;

  if (!session) return;

  const duration = Math.floor((timestamp - session.start_time) / 1000);

  db.prepare(`
    UPDATE activity_sessions
    SET end_time = ?, duration = ?
    WHERE user_id = ? AND guild_id = ? AND activity_name = ? AND start_time = ?
  `).run(timestamp, duration, userId, guildId, name, session.start_time);

  // Update total
  const typeKey = `activity:${name}`;
  db.prepare(`
    INSERT INTO totals (user_id, guild_id, type, total_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, guild_id, type)
    DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds
  `).run(userId, guildId, typeKey, duration);
}

export function getTotalSeconds(userId: string, guildId: string, type: string): number {
  const row = db.prepare(
    'SELECT total_seconds FROM totals WHERE user_id = ? AND guild_id = ? AND type = ?'
  ).get(userId, guildId, type) as { total_seconds: number } | undefined;
  return row?.total_seconds ?? 0;
}