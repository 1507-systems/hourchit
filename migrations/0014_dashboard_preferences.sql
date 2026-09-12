CREATE TABLE dashboard_preferences (
  user_key TEXT PRIMARY KEY,
  module_order TEXT NOT NULL,
  hidden_modules TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
