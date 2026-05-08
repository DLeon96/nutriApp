CREATE TABLE IF NOT EXISTS food_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  date      TEXT DEFAULT (date('now')),
  name      TEXT NOT NULL,
  calories  REAL DEFAULT 0,
  protein   REAL DEFAULT 0,
  carbs     REAL DEFAULT 0,
  fat       REAL DEFAULT 0,
  portion   TEXT
);

CREATE TABLE IF NOT EXISTS exercise_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  timestamp       TEXT DEFAULT (datetime('now')),
  date            TEXT DEFAULT (date('now')),
  type            TEXT NOT NULL,
  duration        INTEGER DEFAULT 0,
  calories_burned REAL DEFAULT 0,
  steps           INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_config (
  user_id       TEXT PRIMARY KEY,
  name          TEXT,
  goal_calories REAL DEFAULT 2000,
  goal_protein  REAL DEFAULT 150
);
