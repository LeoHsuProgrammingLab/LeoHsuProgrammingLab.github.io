#!/usr/bin/env python3
"""
Build assets/json/visited-countries.geojson from _data/travel.yml.

The world map only ever draws the countries carrying a `shape:` under `abroad`,
so shipping all 240 Natural Earth outlines would be wasted bytes. This pulls the
1:50m topology, keeps just those countries, and writes them out as GeoJSON.

Run it after adding or removing a `shape:`:

    python3 bin/build_country_shapes.py

`shape` in _data/travel.yml must match the Natural Earth country name. If one
does not match, this script says so and lists near misses rather than writing a
file with a country silently missing.
"""

import json
import os
import sys
import urllib.request

TOPO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "_data", "travel.yml")
OUT = os.path.join(ROOT, "assets", "json", "visited-countries.geojson")
PRECISION = 4  # ~11 m, far finer than anything drawn at these zoom levels


def wanted_countries():
    """Pull `shape:` values out of the `abroad` block without needing PyYAML."""
    names, in_block = [], False
    with open(DATA, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            if line.startswith("abroad:"):
                in_block = True
                continue
            if in_block:
                if line and not line[0].isspace() and not line.startswith("-"):
                    break
                stripped = line.strip()
                if stripped.startswith("shape:"):
                    names.append(stripped.split(":", 1)[1].strip().strip("\"'"))
    return names


def decode_arcs(topo):
    scale = topo["transform"]["scale"]
    translate = topo["transform"]["translate"]
    out = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append([
                round(x * scale[0] + translate[0], PRECISION),
                round(y * scale[1] + translate[1], PRECISION),
            ])
        out.append(pts)
    return out


def main():
    names = wanted_countries()
    if not names:
        print("No `shape:` entries found under `abroad` in _data/travel.yml; nothing to build.")
        return 0

    print("Fetching", TOPO_URL)
    with urllib.request.urlopen(TOPO_URL, timeout=120) as resp:
        topo = json.load(resp)

    arcs = decode_arcs(topo)

    def ring(idxs):
        pts = []
        for i in idxs:
            a = arcs[~i][::-1] if i < 0 else arcs[i]
            pts.extend(a[1:] if pts else a)
        return pts

    by_name = {g["properties"]["name"]: g for g in topo["objects"]["countries"]["geometries"]}

    missing = [n for n in names if n not in by_name]
    if missing:
        print("\nThese names are not in the Natural Earth country list:")
        for m in missing:
            near = [k for k in by_name if m.lower() in k.lower() or k.lower() in m.lower()]
            print(f"  {m!r}" + (f"  did you mean: {', '.join(sorted(near)[:5])}" if near else ""))
        return 1

    feats = []
    for name in names:
        g = by_name[name]
        if g["type"] == "Polygon":
            coords = [ring(r) for r in g["arcs"]]
        elif g["type"] == "MultiPolygon":
            coords = [[ring(r) for r in poly] for poly in g["arcs"]]
        else:
            print(f"  skipping {name}: unexpected geometry {g['type']}")
            continue
        feats.append({
            "type": "Feature",
            "id": name,
            "properties": {"name": name},
            "geometry": {"type": g["type"], "coordinates": coords},
        })

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))

    size = os.path.getsize(OUT)
    print(f"\nWrote {os.path.relpath(OUT, ROOT)}  ({size / 1024:.1f} KB)")
    for f in feats:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        print(f"  {f['id']:<20} {sum(len(r) for p in polys for r in p)} points")
    return 0


if __name__ == "__main__":
    sys.exit(main())
