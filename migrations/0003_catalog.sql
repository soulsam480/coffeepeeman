DROP TABLE IF EXISTS catalog;

CREATE TABLE catalog (
  id        TEXT PRIMARY KEY,
  roaster   TEXT NOT NULL,
  name      TEXT NOT NULL,
  roast     TEXT,
  process   TEXT,
  flavours  TEXT,
  species   TEXT,
  estate    TEXT,
  region    TEXT,
  price     REAL,
  grams     REAL,
  per100    REAL,
  url       TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX idx_catalog_per100 ON catalog(per100);
