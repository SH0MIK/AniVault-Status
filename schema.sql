CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  checked_at TEXT NOT NULL,       -- ISO 8601, UTC
  ok INTEGER NOT NULL,            -- 1 = healthy, 0 = failed
  status_code INTEGER,
  response_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_checks_service_time ON checks(service, checked_at);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT                   -- NULL while ongoing
);
CREATE INDEX IF NOT EXISTS idx_incidents_service_open ON incidents(service, ended_at);
