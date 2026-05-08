import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'nutribot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS food_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    timestamp  TEXT    DEFAULT (datetime('now', 'localtime')),
    date       TEXT    DEFAULT (date('now', 'localtime')),
    name       TEXT    NOT NULL,
    calories   REAL    DEFAULT 0,
    protein    REAL    DEFAULT 0,
    carbs      REAL    DEFAULT 0,
    fat        REAL    DEFAULT 0,
    portion    TEXT
  );

  CREATE TABLE IF NOT EXISTS exercise_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        TEXT    NOT NULL,
    timestamp      TEXT    DEFAULT (datetime('now', 'localtime')),
    date           TEXT    DEFAULT (date('now', 'localtime')),
    type           TEXT    NOT NULL,
    duration       INTEGER DEFAULT 0,
    calories_burned REAL   DEFAULT 0,
    steps          INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_config (
    user_id       TEXT PRIMARY KEY,
    name          TEXT,
    goal_calories REAL DEFAULT 2000,
    goal_protein  REAL DEFAULT 150
  );
`);

export function logFood(userId, data) {
  db.prepare(`
    INSERT INTO food_log (user_id, name, calories, protein, carbs, fat, portion)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    data.name,
    data.calories  || 0,
    data.protein   || 0,
    data.carbs     || 0,
    data.fat       || 0,
    data.portion   || ''
  );
}

export function logExercise(userId, data) {
  db.prepare(`
    INSERT INTO exercise_log (user_id, type, duration, calories_burned, steps)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    data.type,
    data.duration        || 0,
    data.calories_burned || 0,
    data.steps           || 0
  );
}

export function getTodaySummary(userId) {
  const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD

  const foods = db.prepare(`
    SELECT name, calories, protein, carbs, fat, portion, timestamp
    FROM food_log WHERE user_id = ? AND date = ? ORDER BY timestamp
  `).all(userId, today);

  const exercises = db.prepare(`
    SELECT type, duration, calories_burned, steps, timestamp
    FROM exercise_log WHERE user_id = ? AND date = ? ORDER BY timestamp
  `).all(userId, today);

  const foodTotals = foods.reduce(
    (a, f) => ({ calories: a.calories + f.calories, protein: a.protein + f.protein, carbs: a.carbs + f.carbs, fat: a.fat + f.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const exerciseTotals = exercises.reduce(
    (a, e) => ({ calories_burned: a.calories_burned + e.calories_burned, steps: a.steps + e.steps }),
    { calories_burned: 0, steps: 0 }
  );

  return { foods, exercises, foodTotals, exerciseTotals, date: today };
}

export function getUserConfig(userId) {
  return db.prepare('SELECT * FROM user_config WHERE user_id = ?').get(userId)
    || { user_id: userId, goal_calories: 2000, goal_protein: 150 };
}

export function setUserConfig(userId, config) {
  db.prepare(`
    INSERT INTO user_config (user_id, name, goal_calories, goal_protein)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      name          = excluded.name,
      goal_calories = excluded.goal_calories,
      goal_protein  = excluded.goal_protein
  `).run(userId, config.name || null, config.goal_calories || 2000, config.goal_protein || 150);
}

export function isNewUser(userId) {
  return !db.prepare('SELECT 1 FROM user_config WHERE user_id = ?').get(userId);
}

export function deleteLastFood(userId) {
  const last = db.prepare(`
    SELECT id FROM food_log WHERE user_id = ? ORDER BY id DESC LIMIT 1
  `).get(userId);
  if (last) db.prepare('DELETE FROM food_log WHERE id = ?').run(last.id);
  return !!last;
}

export default db;
