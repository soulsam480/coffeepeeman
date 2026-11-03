#!/usr/bin/env python3
"""Download Saptabeeja's catalog and write data/catalog.json.

Run it by hand or from cron. It is idempotent and exits non-zero on failure,
so a scheduler can tell when it didn't run.
"""

import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://saptabeeja.coffee"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "catalog.json")
UA = "coffee-ledger/1.0 (personal catalog sync)"
WORKERS = 4


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
        for slug, data in pool.map(details, slugs):
            detail.update(data)

    rows = []
    for c in index["coffees"]:
        price, grams = c.get("price"), c.get("grams")
        per100 = round(price / grams * 100, 1) if price and grams else None
        d = detail.get(c["id"], {})
        rows.append({
            "id": c["id"],
            "roaster": names.get(c["roaster"], c["roaster"]),
            "name": c["name"],
            "roast": c.get("roast"),
            "process": c.get("process") or [],
            "flavours": c.get("flavours") or [],
            "species": c.get("species") or [],
            "estate": c.get("estate"),
            "region": c.get("region"),
            "price": price,
            "grams": grams,
            "per100": per100,
            "url": d.get("url"),
        })

    rows.sort(key=lambda r: (r["per100"] is None, r["per100"] or 0))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(rows, f, separators=(",", ":"))
    os.replace(tmp, OUT)

    print(f"synced {len(rows)} coffees from {len(slugs)} roasters -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
