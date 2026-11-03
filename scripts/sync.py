#!/usr/bin/env python3
"""Fetch Saptabeeja's catalog and load it into D1.

Run by hand whenever you want to refresh:

    python3 scripts/sync.py

It writes a temporary SQL file and runs `wrangler d1 execute --remote`.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://saptabeeja.coffee"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = "coffee-ledger"
UA = "coffee-ledger/1.0 (personal catalog sync)"
WORKERS = 4
CHUNK = 200


def get(path, retries=3):
    url = f"{BASE}{path}"
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    return None


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        value = json.dumps(value, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"


def main():
    index = get("/data/catalog-index.json")
    if not index:
        print("sync failed: no catalog index", file=sys.stderr)
        return 1

    names = {r["slug"]: r["name"] for r in index["roasters"]}
    slugs = sorted({r["slug"] for r in index["roasters"] if r.get("count", 0) > 0})

    def details(slug):
        return slug, get(f"/data/details/{slug}.json") or {}

    detail = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for _, data in pool.map(details, slugs):
            detail.update(data)

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    for c in index["coffees"]:
        price, grams = c.get("price"), c.get("grams")
        per100 = round(price / grams * 100, 1) if price and grams else None
        d = detail.get(c["id"], {})
        rows.append(
            "("
            + ", ".join(
                [
                    q(c["id"]),
                    q(names.get(c["roaster"], c["roaster"])),
                    q(c.get("name")),
                    q(c.get("roast")),
                    q(c.get("process") or []),
                    q(c.get("flavours") or []),
                    q(c.get("species") or []),
                    q(c.get("estate")),
                    q(c.get("region")),
                    q(price),
                    q(grams),
                    q(per100),
                    q(d.get("url")),
                    q(now),
                ]
            )
            + ")"
        )

    columns = (
        "id, roaster, name, roast, process, flavours, species, estate, region, "
        "price, grams, per100, url, synced_at"
    )

    sql = ["DELETE FROM catalog;"]
    for i in range(0, len(rows), CHUNK):
        sql.append(
            f"INSERT INTO catalog ({columns}) VALUES\n" + ",\n".join(rows[i : i + CHUNK]) + ";"
        )

    fd, path = tempfile.mkstemp(suffix=".sql", prefix="coffee-sync-")
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(sql) + "\n")

    try:
        subprocess.run(
            ["npx", "wrangler", "d1", "execute", DB, "--remote", "--file", path],
            cwd=ROOT,
            check=True,
        )
    finally:
        os.unlink(path)

    print(f"loaded {len(rows)} coffees from {len(slugs)} roasters into {DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
