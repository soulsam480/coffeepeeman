DROP TABLE IF EXISTS bags;

CREATE TABLE bags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  roaster    TEXT NOT NULL,
  name       TEXT NOT NULL,
  roast      TEXT,
  price      REAL,
  grams      REAL,
  date       TEXT NOT NULL,
  black      INTEGER,
  milk       INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_bags_date ON bags(date DESC, id DESC);
