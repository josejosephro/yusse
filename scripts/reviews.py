#!/usr/bin/env python3
# -----------------------------------------------------------------------------
# Adaptado (traducido al espanol y ajustado al flujo de
# /adrian-saenz-copia-software) a partir de replica-skill:
# https://github.com/Jakeschincariol/replica-skill
#
# MIT License
#
# Copyright (c) 2026 Jake Schincariol
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
# -----------------------------------------------------------------------------
"""Ranking de resenas para /adrian-saenz-copia-software. Solo libreria estandar.

Toma las resenas reales que has reunido del software que vas a copiar y ordena
lo que sus usuarios odian y lo que piden una y otra vez, con las palabras exactas
y un enlace para cada afirmacion.

    python3 reviews.py replica/resenas.csv
    python3 reviews.py replica/resenas.csv --out replica/feedback.md
    python3 reviews.py replica/resenas.csv --json
    python3 reviews.py replica/resenas.csv --themes mis-temas.json

El CSV necesita estas columnas (las demas se ignoran):

    source   de donde viene: app-store, google-play, g2, capterra, trustpilot,
             reddit, foro, ...
    url      el enlace a la resena o al hilo. Obligatorio.
    date     AAAA-MM-DD si lo tienes (AAAA-MM vale)
    rating   de 1 a 5 estrellas si la fuente las tiene, si no en blanco
    text     la resena, copiada tal cual. Obligatorio.

Una fila sin url o sin texto se descarta y se cuenta, nunca se inventa. Esta
herramienta solo reordena lo que le das. No escribe resenas, no las parafrasea,
y cada cita que imprime es un trozo literal de una fila tuya, con su enlace.

Como se puntua un tema: cada resena que encaja suma un peso. Una resena de 1
estrella suma 1.0, una de 5 suma 0.2, una sin estrellas suma 0.6. Las resenas de
mas de --months (18 por defecto) cuentan la mitad. Los temas con menos de 3
resenas, o todas de una sola fuente, se marcan como poco solidos.
"""

import argparse
import csv
import datetime as _dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_THEMES = os.path.join(HERE, "temas-resenas.json")
SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


class FeedbackError(Exception):
    pass


def load_themes(path=DEFAULT_THEMES):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    themes = []
    for t in data.get("themes", []):
        themes.append({
            "id": t["id"], "label": t.get("label", t["id"]),
            "kind": t.get("kind", "complaint"),
            "patterns": [re.compile(p, re.I) for p in t.get("patterns", [])],
        })
    requests = [re.compile(p, re.I) for p in data.get("request_patterns", [])]
    return themes, requests


def parse_date(text):
    text = (text or "").strip()
    for fmt, n in (("%Y-%m-%d", 10), ("%Y-%m", 7)):
        try:
            return _dt.datetime.strptime(text[:n], fmt).date()
        except ValueError:
            continue
    return None


def parse_rating(text):
    text = (text or "").strip()
    if not text:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)", text)
    if not m:
        return None
    value = float(m.group(1))
    if value < 1 or value > 5:
        return None
    return value


def load_reviews(path):
    """Devuelve (filas conservadas, descartadas, duplicadas)."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise FeedbackError("%s esta vacio" % path)
        cols = [c.strip().lower() for c in reader.fieldnames]
        for need in ("url", "text"):
            if need not in cols:
                raise FeedbackError(
                    "%s no tiene la columna '%s'. Cada resena necesita el enlace de "
                    "donde viene y su texto exacto: source,url,date,rating,text"
                    % (path, need))
        kept, dropped, dupes = [], 0, 0
        seen = set()
        for i, raw in enumerate(reader, start=2):
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
            url, text = row.get("url", ""), row.get("text", "")
            if not url or not text or not re.match(r"^https?://", url):
                dropped += 1
                continue
            key = re.sub(r"\W+", " ", text.lower()).strip()
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            kept.append({
                "line": i,
                "source": row.get("source", "") or _host(url),
                "url": url,
                "date": parse_date(row.get("date", "")),
                "rating": parse_rating(row.get("rating", "")),
                "text": text,
            })
    return kept, dropped, dupes


def _host(url):
    m = re.match(r"^https?://(?:www\.)?([^/]+)", url)
    return m.group(1) if m else "desconocida"


def weight(review, today, months):
    r = review["rating"]
    w = 0.6 if r is None else (6.0 - r) / 5.0
    if review["date"] is not None and today is not None:
        age_days = (today - review["date"]).days
        if age_days > months * 30.4:
            w *= 0.5
    return w


def snippet(text, pattern, limit=220):
    """La primera frase del texto que encaja con el patron, literal."""
    for sent in SENTENCE.split(text):
        if pattern.search(sent):
            s = sent.strip()
            if len(s) > limit:
                m = pattern.search(s)
                start = max(0, m.start() - limit // 2)
                s = s[start:start + limit].strip()
                s = ("..." if start > 0 else "") + s + "..."
            return s
    s = text.strip()
    return s if len(s) <= limit else s[:limit].rstrip() + "..."


def analyse(reviews, themes, request_patterns, today=None, months=18):
    if today is None:
        today = _dt.date.today()
    results = {t["id"]: {"id": t["id"], "label": t["label"], "kind": t["kind"],
                         "reviews": [], "score": 0.0} for t in themes}
    requests = []
    unthemed_negative = []
    for rv in reviews:
        w = weight(rv, today, months)
        matched = False
        for t in themes:
            hit = next((p for p in t["patterns"] if p.search(rv["text"])), None)
            if hit is None:
                continue
            matched = True
            res = results[t["id"]]
            res["score"] += w
            res["reviews"].append({"rv": rv, "quote": snippet(rv["text"], hit)})
        req = next((p for p in request_patterns if p.search(rv["text"])), None)
        if req is not None:
            requests.append({"quote": snippet(rv["text"], req), "url": rv["url"],
                             "source": rv["source"], "rating": rv["rating"]})
        if not matched and rv["rating"] is not None and rv["rating"] <= 2:
            unthemed_negative.append(rv)

    total = len(reviews) or 1
    ranked = []
    for res in results.values():
        items = res["reviews"]
        if not items:
            continue
        rated = [x["rv"]["rating"] for x in items if x["rv"]["rating"] is not None]
        sources = sorted({x["rv"]["source"] for x in items})
        # Peor valorada primero, luego mas corta, para que las citas sean las mas afiladas.
        items.sort(key=lambda x: (x["rv"]["rating"] if x["rv"]["rating"] is not None else 3,
                                  len(x["quote"])))
        ranked.append({
            "id": res["id"], "label": res["label"], "kind": res["kind"],
            "score": round(res["score"], 2),
            "count": len(items),
            "share_pct": round(100.0 * len(items) / total, 1),
            "avg_rating": round(sum(rated) / len(rated), 2) if rated else None,
            "sources": sources,
            "thin": len(items) < 3 or len(sources) < 2,
            "quotes": [{"quote": x["quote"], "url": x["rv"]["url"],
                        "source": x["rv"]["source"], "rating": x["rv"]["rating"]}
                       for x in items[:3]],
        })
    ranked.sort(key=lambda d: (-d["score"], -d["count"], d["id"]))
    return {
        "reviews": len(reviews),
        "sources": sorted({r["source"] for r in reviews}),
        "rated": sum(1 for r in reviews if r["rating"] is not None),
        "themes": ranked,
        "requests": requests,
        "unthemed_negative": [{"url": r["url"], "source": r["source"],
                               "rating": r["rating"], "text": r["text"][:220]}
                              for r in unthemed_negative],
    }


def _stars(r):
    return "-" if r is None else ("%g*" % r)


def render(result, dropped=0, dupes=0):
    out = ["# Lo que odian y lo que piden los usuarios del original", ""]
    out.append("%d resenas de %d fuentes (%s). %d tenian estrellas." % (
        result["reviews"], len(result["sources"]), ", ".join(result["sources"]) or "ninguna",
        result["rated"]))
    if dropped:
        out.append("%d filas descartadas: sin enlace o sin texto. Nada cuenta sin "
                   "su fuente." % dropped)
    if dupes:
        out.append("%d resenas duplicadas eliminadas." % dupes)
    if result["reviews"] < 30:
        out.append("")
        out.append("Muestra pequena. Menos de 30 resenas marca una direccion, no un "
                   "ranking. Reune mas antes de apostar la hoja de ruta.")
    for kind, title in (("complaint", "Lo que odian"), ("request", "Lo que piden")):
        rows = [t for t in result["themes"] if t["kind"] == kind]
        out.append("")
        out.append("## %s" % title)
        out.append("")
        if not rows:
            out.append("Nada encajo. Lee las resenas a mano.")
            continue
        out.append("| puesto | tema | puntos | resenas | % | estrellas media | fuentes |")
        out.append("| --- | --- | --- | --- | --- | --- | --- |")
        for i, t in enumerate(rows, 1):
            out.append("| %d | %s%s | %.1f | %d | %.0f%% | %s | %d |" % (
                i, t["label"], " (poco solida)" if t["thin"] else "", t["score"], t["count"],
                t["share_pct"], "-" if t["avg_rating"] is None else "%.1f" % t["avg_rating"],
                len(t["sources"])))
        for t in rows[:6]:
            out.append("")
            out.append("**%s**" % t["label"])
            for q in t["quotes"]:
                out.append('- "%s" (%s, %s) %s' % (q["quote"], q["source"],
                                                   _stars(q["rating"]), q["url"]))
    if result["requests"]:
        out.append("")
        out.append("## Pedido con sus propias palabras")
        out.append("")
        for q in result["requests"][:25]:
            out.append('- "%s" (%s, %s) %s' % (q["quote"], q["source"],
                                               _stars(q["rating"]), q["url"]))
    if result["unthemed_negative"]:
        out.append("")
        out.append("## Lee estas a mano")
        out.append("")
        out.append("Valoraciones bajas que no encajaron en ningun tema. O son ruido, "
                   "o un tema que temas-resenas.json aun no tiene. Suele ser lo mas util.")
        out.append("")
        for r in result["unthemed_negative"][:15]:
            out.append('- (%s, %s) %s: "%s"' % (r["source"], _stars(r["rating"]),
                                               r["url"], r["text"]))
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("reviews", help="CSV con source,url,date,rating,text")
    ap.add_argument("--themes", default=DEFAULT_THEMES)
    ap.add_argument("--months", type=int, default=18,
                    help="las resenas mas viejas que esto cuentan la mitad (18 por defecto)")
    ap.add_argument("--today", help="AAAA-MM-DD, para ejecuciones reproducibles")
    ap.add_argument("--out", help="escribe aqui el informe en markdown")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        themes, req = load_themes(args.themes)
        reviews, dropped, dupes = load_reviews(args.reviews)
    except (FeedbackError, OSError, ValueError, KeyError, re.error) as exc:
        print("reviews: %s" % exc, file=sys.stderr)
        return 2
    if not reviews:
        print("reviews: no hay filas usables. Cada fila necesita una url (http...) y "
              "el texto de la resena.", file=sys.stderr)
        return 2
    today = parse_date(args.today) if args.today else None
    result = analyse(reviews, themes, req, today=today, months=args.months)
    result["dropped"] = dropped
    result["duplicates"] = dupes
    if args.json:
        print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
        return 0
    text = render(result, dropped, dupes)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("escrito %s" % args.out)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
