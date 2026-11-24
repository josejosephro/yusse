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
"""Parecido de funciones (parity) para /adrian-saenz-copia-software. Solo libreria estandar.

Lee la matriz de funciones (lo que hace el original y cuanto llevas tu) y dice
que porcentaje del original cubre tu version, que falta y en que orden construirlo.

    python3 parity.py replica/funciones.csv
    python3 parity.py replica/funciones.csv --visual diffs/*.json
    python3 parity.py replica/funciones.csv --markdown > replica/parecido.md
    python3 parity.py replica/funciones.csv --fail-under 80

El CSV tiene estas columnas (las demas se ignoran). Acepta nombres en espanol o ingles:

    funcion   / feature    que hace, en palabras ("reprogramar una reserva")
    zona      / area       la pantalla o flujo al que pertenece ("pagina de reserva")
    prioridad / priority   imprescindible | importante | opcional  (must | should | could)
    original               si | no      el original lo tiene?
    clon      / clone      si | parcial | no | saltar  (yes | partial | no | skip)
    notas     / notes      lo que sea. Para "saltar", di por que ("fuera de alcance").

Pesos: imprescindible 3, importante 2, opcional 1. si vale 1, parcial 0.5, no 0.
"saltar" y las filas con original "no" (funciones que anades tu) quedan fuera del
numero y se listan aparte, para que el porcentaje mida solo el parecido.

Con --visual se promedian las puntuaciones de maqueta de imgdiff.py --json y se
informan junto a las de funciones; el total es 80% funciones + 20% maqueta. Las
funciones son lo que paga la gente.
"""

import argparse
import csv
import json
import sys

WEIGHT = {"imprescindible": 3, "importante": 2, "opcional": 1,
          "must": 3, "should": 2, "could": 1, "p0": 3, "p1": 2, "p2": 1}
CREDIT = {"si": 1.0, "sí": 1.0, "hecho": 1.0, "yes": 1.0, "done": 1.0,
          "parcial": 0.5, "partial": 0.5,
          "no": 0.0, "": 0.0, "pendiente": 0.0, "todo": 0.0}
PRIORITY_NAME = {3: "imprescindible", 2: "importante", 1: "opcional"}
SKIP = {"saltar", "omitir", "skip"}
NEG_ORIGINAL = {"no", "n", "false"}
ALIAS = {"función": "feature", "funcion": "feature", "feature": "feature",
         "zona": "area", "área": "area", "area": "area",
         "prioridad": "priority", "priority": "priority",
         "original": "original",
         "clon": "clone", "clone": "clone",
         "notas": "notes", "notes": "notes"}
NAME = {"feature": "funcion/feature", "priority": "prioridad/priority",
        "clone": "clon/clone"}


class MatrixError(Exception):
    pass


def _key(k):
    k = (k or "").strip().lower()
    return ALIAS.get(k, k)


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            raise MatrixError("%s esta vacio" % path)
        fields = [_key(f) for f in reader.fieldnames]
        for need in ("feature", "priority", "clone"):
            if need not in fields:
                raise MatrixError("%s no tiene la columna '%s'. Columnas: "
                                  "funcion, zona, prioridad, original, clon, notas"
                                  % (path, NAME[need]))
        rows = []
        for i, raw in enumerate(reader, start=2):
            row = {_key(k): (v or "").strip() for k, v in raw.items()}
            if not row.get("feature"):
                continue
            row["line"] = i
            rows.append(row)
    return rows


def score(rows):
    counted = []
    skipped = []
    extras = []
    problems = []
    for row in rows:
        original = row.get("original", "si").lower() or "si"
        clone = row.get("clone", "").lower()
        prio = row.get("priority", "").lower()
        if original in NEG_ORIGINAL:
            extras.append(row)
            continue
        if clone in SKIP:
            skipped.append(row)
            continue
        if prio not in WEIGHT:
            problems.append("linea %d: la prioridad '%s' no es imprescindible/importante/"
                            "opcional, cuenta como opcional"
                            % (row["line"], row.get("priority", "")))
        if clone not in CREDIT:
            problems.append("linea %d: el clon '%s' no es si/parcial/no/saltar, cuenta como no"
                            % (row["line"], row.get("clone", "")))
        w = WEIGHT.get(prio, 1)
        c = CREDIT.get(clone, 0.0)
        counted.append(dict(row, weight=w, credit=c))

    total = sum(r["weight"] for r in counted)
    got = sum(r["weight"] * r["credit"] for r in counted)
    feature_score = 100.0 * got / total if total else 0.0

    areas = {}
    for r in counted:
        a = r.get("area") or "(sin zona)"
        t = areas.setdefault(a, [0.0, 0.0, 0])
        t[0] += r["weight"] * r["credit"]
        t[1] += r["weight"]
        t[2] += 1
    by_area = sorted(
        ({"area": a, "score": round(100.0 * g / t, 1) if t else 0.0, "features": n}
         for a, (g, t, n) in areas.items()),
        key=lambda d: d["score"])

    missing = [r for r in counted if r["credit"] < 1.0]
    missing.sort(key=lambda r: (-r["weight"], r["credit"], r.get("area", ""), r["feature"]))

    def brief(r):
        return {"feature": r["feature"], "area": r.get("area", ""),
                "priority": PRIORITY_NAME.get(r.get("weight", WEIGHT.get(
                    r.get("priority", "").lower(), 1)), "opcional"),
                "clone": r.get("clone", "") or "no", "notes": r.get("notes", "")}

    musts = [r for r in counted if r["weight"] == 3]
    return {
        "feature_score": round(feature_score, 1),
        "counted": len(counted),
        "must_have_done": sum(1 for r in musts if r["credit"] == 1.0),
        "must_have_total": len(musts),
        "by_area": by_area,
        "missing": [brief(r) for r in missing],
        "skipped": [brief(r) for r in skipped],
        "extras": [brief(r) for r in extras],
        "problems": problems,
    }


def visual_scores(paths):
    scores = []
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        if "score" not in data:
            raise MatrixError("%s no es salida de imgdiff.py --json" % p)
        name = data.get("files", {}).get("clone", p)
        scores.append({"file": name, "score": float(data["score"]),
                       "mode": data.get("mode", "layout")})
    return scores


def combine(result, visuals):
    if visuals:
        layout = sum(v["score"] for v in visuals) / len(visuals)
        result["visual"] = visuals
        result["layout_score"] = round(layout, 1)
        result["overall"] = round(0.8 * result["feature_score"] + 0.2 * layout, 1)
    else:
        result["overall"] = result["feature_score"]
    return result


def render(result, markdown=False):
    out = []
    h = "## " if markdown else ""
    out.append("%sParecido: %.1f / 100" % (h, result["overall"]))
    out.append("")
    out.append("funciones %.1f  (%d contadas, imprescindibles %d de %d hechas)" % (
        result["feature_score"], result["counted"], result["must_have_done"],
        result["must_have_total"]))
    if "layout_score" in result:
        out.append("maqueta   %.1f  (%d pantallas comparadas)" % (
            result["layout_score"], len(result["visual"])))
    if result["must_have_done"] < result["must_have_total"]:
        out.append("")
        out.append("Aun no publicable: faltan %d funciones imprescindibles."
                   % (result["must_have_total"] - result["must_have_done"]))
    out.append("")
    out.append("%sPor zona, de la mas floja a la mas fuerte" % h)
    for a in result["by_area"]:
        out.append("- %-28s %5.1f  (%d funciones)" % (a["area"], a["score"], a["features"]))
    out.append("")
    out.append("%sLo que falta, en orden de construccion" % h)
    if not result["missing"]:
        out.append("- nada. Todas las funciones contadas estan hechas.")
    for m in result["missing"]:
        note = ("  (%s)" % m["notes"]) if m["notes"] else ""
        out.append("- [%s] %s: %s, %s%s" % (m["priority"], m["area"] or "-",
                                             m["feature"], m["clone"], note))
    if result["skipped"]:
        out.append("")
        out.append("%sDejado fuera a proposito (no cuenta)" % h)
        for m in result["skipped"]:
            out.append("- %s: %s" % (m["feature"], m["notes"] or "sin motivo, anade uno"))
    if result["extras"]:
        out.append("")
        out.append("%sTuyo, no esta en el original (no cuenta)" % h)
        for m in result["extras"]:
            out.append("- %s" % m["feature"])
    if result.get("visual"):
        out.append("")
        out.append("%sPantallas" % h)
        for v in sorted(result["visual"], key=lambda d: d["score"]):
            out.append("- %-40s %5.1f" % (v["file"], v["score"]))
    if result["problems"]:
        out.append("")
        out.append("%sCorrige en la matriz" % h)
        for p in result["problems"]:
            out.append("- %s" % p)
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("matrix", help="la matriz de funciones (CSV)")
    ap.add_argument("--visual", nargs="*", default=[],
                    help="salidas de imgdiff.py --json para sumar")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--fail-under", type=float)
    args = ap.parse_args(argv)
    try:
        result = combine(score(load(args.matrix)), visual_scores(args.visual))
    except (MatrixError, OSError, ValueError) as exc:
        print("parity: %s" % exc, file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(render(result, markdown=args.markdown))
    if args.fail_under is not None and result["overall"] < args.fail_under:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
