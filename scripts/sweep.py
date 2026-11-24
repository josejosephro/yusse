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
"""Candado de marca para /adrian-saenz-copia-software. Solo libreria estandar.

Busca en el codigo de tu version cualquier cosa que siga siendo del software
original: su nombre, su dominio, sus colores de marca. Pasalo antes de cada
publicacion. Sale con codigo 1 si encuentra algo, asi puede frenar un despliegue.

    python3 sweep.py . --avoid "Kahoot"
    python3 sweep.py . --avoid "Kahoot,Kahoot!" --domains kahoot.com \\
        --colors "#46178f,#e21b3c"
    python3 sweep.py . --config replica/marca.json --json

--config lee {"avoid": [...], "domains": [...], "colors": [...]}.

Los nombres se buscan sin distinguir mayusculas en cualquier parte, incluso
dentro de identificadores (KahootBoton, kahoot_sync), porque tambien se publican.
Los colores se buscan en cualquier caja y en forma corta (#06f encuentra #0066ff).
Se revisan los nombres de ficheros y carpetas ademas del contenido.

Se saltan: .git, node_modules, carpetas de build, ficheros de bloqueo, binarios y
la carpeta replica/ de planificacion (donde el nombre del original SI debe estar).
Pasa --include-replica para revisarla tambien.
"""

import argparse
import json
import os
import re
import sys

SKIP_DIRS = {".git", "node_modules", ".next", ".nuxt", ".svelte-kit", "dist", "build",
             "out", ".vercel", ".turbo", ".cache", "__pycache__", ".venv",
             "venv", "Pods", ".expo", "DerivedData", ".gradle"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
              "Podfile.lock", "Cargo.lock", "poetry.lock"}
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip",
              ".gz", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mov", ".mp3",
              ".wav", ".avif", ".heic", ".psd", ".sketch", ".fig", ".jar", ".so", ".dylib"}
HEX = re.compile(r"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])")
KIND_ES = {"name": "nombre", "domain": "dominio", "color": "color", "path": "ruta"}


def norm_hex(h):
    h = h.lower().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h


def build_patterns(avoid, domains):
    pats = []
    for name in avoid:
        name = name.strip()
        if not name:
            continue
        # "Acuity Scheduling" tambien encuentra AcuityScheduling y acuity-scheduling
        parts = [re.escape(p) for p in re.split(r"[\s_-]+", name) if p]
        pats.append(("name", name, re.compile(r"[\s_-]?".join(parts), re.I)))
    for d in domains:
        d = d.strip().lower()
        if d:
            pats.append(("domain", d, re.compile(re.escape(d), re.I)))
    return pats


def is_binary(path):
    if os.path.splitext(path)[1].lower() in BINARY_EXT:
        return True
    try:
        with open(path, "rb") as fh:
            return b"\0" in fh.read(4096)
    except OSError:
        return True


def sweep(root, avoid=(), domains=(), colors=(), include_replica=False, max_size=2_000_000):
    pats = build_patterns(avoid, domains)
    cols = {norm_hex(c) for c in colors if HEX.fullmatch(c.strip())}
    hits = []
    root = os.path.abspath(root)
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        keep = []
        for d in dirnames:
            if d in SKIP_DIRS:
                continue
            if d == "replica" and rel_dir == "." and not include_replica:
                continue
            keep.append(d)
        dirnames[:] = sorted(keep)
        for d in dirnames:
            for kind, label, rx in pats:
                if kind == "name" and rx.search(d):
                    hits.append({"file": os.path.normpath(os.path.join(rel_dir, d)) + "/",
                                 "line": 0, "kind": "path", "match": label,
                                 "text": "nombre de carpeta"})
        for fn in sorted(filenames):
            if fn in SKIP_FILES:
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.normpath(os.path.join(rel_dir, fn))
            for kind, label, rx in pats:
                if kind == "name" and rx.search(fn):
                    hits.append({"file": rel, "line": 0, "kind": "path", "match": label,
                                 "text": "nombre de fichero"})
            try:
                if os.path.getsize(path) > max_size or is_binary(path):
                    continue
                with open(path, encoding="utf-8", errors="replace") as fh:
                    lines = fh.readlines()
            except OSError:
                continue
            for i, line in enumerate(lines, 1):
                for kind, label, rx in pats:
                    if rx.search(line):
                        hits.append({"file": rel, "line": i, "kind": kind, "match": label,
                                     "text": line.strip()[:160]})
                if cols:
                    for m in HEX.finditer(line):
                        if norm_hex(m.group(0)) in cols:
                            hits.append({"file": rel, "line": i, "kind": "color",
                                         "match": norm_hex(m.group(0)),
                                         "text": line.strip()[:160]})
    return hits


def render(hits):
    if not hits:
        return "Limpio. No queda nada del nombre, el dominio ni los colores del original."
    out = []
    by_kind = {}
    for h in hits:
        by_kind.setdefault(h["kind"], 0)
        by_kind[h["kind"]] += 1
        loc = h["file"] if not h["line"] else "%s:%d" % (h["file"], h["line"])
        out.append("%-7s %-18s %s  %s" % (KIND_ES.get(h["kind"], h["kind"]),
                                          h["match"][:18], loc, h["text"]))
    out.append("")
    out.append("%d coincidencias (%s). Reemplaza todas antes de publicar."
               % (len(hits), ", ".join("%s %d" % (KIND_ES.get(k, k), n)
                                       for k, n in sorted(by_kind.items()))))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--avoid", default="", help="nombres separados por comas")
    ap.add_argument("--domains", default="", help="dominios separados por comas")
    ap.add_argument("--colors", default="", help="colores hex separados por comas")
    ap.add_argument("--config", help="JSON con listas avoid / domains / colors")
    ap.add_argument("--include-replica", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    avoid = [x for x in args.avoid.split(",") if x.strip()]
    domains = [x for x in args.domains.split(",") if x.strip()]
    colors = [x for x in args.colors.split(",") if x.strip()]
    if args.config:
        try:
            with open(args.config, encoding="utf-8") as fh:
                cfg = json.load(fh)
        except (OSError, ValueError) as exc:
            print("sweep: %s" % exc, file=sys.stderr)
            return 2
        avoid += cfg.get("avoid", [])
        domains += cfg.get("domains", [])
        colors += cfg.get("colors", [])
    if not (avoid or domains or colors):
        print("sweep: no hay nada que buscar. Pasa --avoid con el nombre del original.",
              file=sys.stderr)
        return 2
    hits = sweep(args.root, avoid, domains, colors, args.include_replica)
    print(json.dumps(hits, indent=2, ensure_ascii=False) if args.json else render(hits))
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
