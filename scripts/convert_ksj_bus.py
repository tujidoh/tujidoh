#!/usr/bin/env python3
"""国土数値情報 バスルート(N07) / バス停留所(P11) の JPGIS2.1(GML) を
伊丹市周辺に切り出して GeoJSON に変換するスクリプト。

使い方:
  python3 scripts/convert_ksj_bus.py <N07_xml...> --stops <P11_xml...> --out public/data

出典: 国土交通省 国土数値情報（バスルートデータ N07 2022年度 / バス停留所データ P11 2022年度）
ライセンス: CC BY 4.0
"""
import argparse, json, os, re, xml.etree.ElementTree as ET

NS = {"gml": "http://www.opengis.net/gml/3.2", "ksj": "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app",
      "xlink": "http://www.w3.org/1999/xlink"}
# 伊丹市・尼崎市北部・宝塚市南部・川西市南部・豊中市周辺
BBOX = (34.725, 135.33, 34.865, 135.505)  # (minLat, minLon, maxLat, maxLon)

def inb(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]

OLD = "http://schemas.opengis.net/gml/3.2.1"

def ns_fix(root):
    # gml 名前空間の表記揺れ対策（タグ・属性の両方）
    for el in root.iter():
        if el.tag.startswith("{" + OLD + "}"):
            el.tag = el.tag.replace(OLD, NS["gml"])
        for k in [k for k in el.attrib if k.startswith("{" + OLD + "}")]:
            el.attrib[k.replace(OLD, NS["gml"])] = el.attrib.pop(k)
    return root

XL = "{http://www.w3.org/1999/xlink}href"

def routes(path):
    root = ns_fix(ET.parse(path).getroot())
    curves = {}
    for c in root.findall("gml:Curve", NS):
        cid = c.get("{%s}id" % NS["gml"])
        coords = []
        for pl in c.iter("{%s}posList" % NS["gml"]):
            v = pl.text.split()
            for i in range(0, len(v) - 1, 2):
                coords.append((float(v[i]), float(v[i + 1])))
        curves[cid] = coords
    feats = []
    for br in root.findall("ksj:BusRoute", NS):
        ref = br.find("ksj:loc", NS).get(XL).lstrip("#")
        pts = curves.get(ref, [])
        if not any(inb(a, b) for a, b in pts):
            continue
        g = lambda t: (br.findtext("ksj:" + t, default="", namespaces=NS) or "").strip()
        props = {"operator": g("boc")}
        for k, name in (("bsc", "busType"), ("bln", "line"), ("rpd", "weekday"), ("rsd", "saturday"), ("rhd", "holiday"), ("rmk", "note")):
            if g(k):
                props[name] = g(k)
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString", "coordinates": [[round(b, 6), round(a, 6)] for a, b in pts]}})
    return feats

def stops(path):
    root = ns_fix(ET.parse(path).getroot())
    pts = {}
    for p in root.findall("gml:Point", NS):
        v = p.findtext("gml:pos", namespaces=NS).split()
        pts[p.get("{%s}id" % NS["gml"])] = (float(v[0]), float(v[1]))
    out = {}
    for bs in root.findall("ksj:BusStop", NS):
        lat, lon = pts[bs.find("ksj:loc", NS).get(XL).lstrip("#")]
        if not inb(lat, lon):
            continue
        name = bs.findtext("ksj:bsn", namespaces=NS) or ""
        op = bs.findtext("ksj:boc", namespaces=NS) or ""
        lines = [b.findtext("ksj:brn", namespaces=NS) or "" for b in bs.findall("ksj:bri", NS)]
        key = (name, round(lat, 5), round(lon, 5))
        e = out.setdefault(key, {"name": name, "operators": [], "lines": [], "lat": lat, "lon": lon})
        if op and op not in e["operators"]:
            e["operators"].append(op)
        for l in lines:
            if l and l not in e["lines"]:
                e["lines"].append(l)
    return [{"type": "Feature", "properties": {"name": e["name"], "operator": "、".join(e["operators"]), "lines": "、".join(e["lines"])},
             "geometry": {"type": "Point", "coordinates": [round(e["lon"], 6), round(e["lat"], 6)]}} for e in out.values()]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("routes", nargs="+")
    ap.add_argument("--stops", nargs="+", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    meta = {"source": "国土交通省 国土数値情報", "license": "CC BY 4.0", "bbox": BBOX}
    rf = [f for p in a.routes for f in routes(p)]
    sf = [f for p in a.stops for f in stops(p)]
    json.dump({"type": "FeatureCollection", "name": "国土数値情報 バスルート N07（2022年度）", "metadata": {**meta, "dataset": "N07-2022"}, "features": rf},
              open(os.path.join(a.out, "bus_routes_n07_2022.geojson"), "w"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"type": "FeatureCollection", "name": "国土数値情報 バス停留所 P11（2022年度）", "metadata": {**meta, "dataset": "P11-2022"}, "features": sf},
              open(os.path.join(a.out, "bus_stops_p11_2022.geojson"), "w"), ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print("routes", len(rf), Counter(f["properties"]["operator"] for f in rf))
    print("stops", len(sf), Counter(f["properties"]["operator"] for f in sf).most_common(15))

if __name__ == "__main__":
    main()
