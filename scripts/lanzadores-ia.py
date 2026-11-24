#!/usr/bin/env python3
"""lanzadores-ia.py — crea CONECTAR-IA.cmd (Windows) y CONECTAR-IA.command (Mac)
en la carpeta del proyecto. Parte de la skill /adrian-saenz-copia-software.

Son la forma más sencilla de que el usuario inicie sesión de Claude en su VPS:
un doble clic (o que Claude lo abra con `start` / `open`) abre una ventana de
terminal de verdad, ya conectada a la VPS con la clave de secret/ y lanzando
`conectar-ia` (lo deja instalado scripts/instalar-ia.sh). Las rutas van
ABSOLUTAS: con una ruta relativa, o abierto desde otra carpeta, ssh no encuentra
la clave y pide la contraseña de root, que es justo lo que confunde.

Uso:
  python scripts/lanzadores-ia.py --ip 203.0.113.10 --clave secret/miapp_vps [--usuario miapp] [--dir .]

Solo librería estándar. No toca la VPS ni imprime la clave.
"""

import argparse
import ipaddress
import os
import re
import stat
import sys

NOMBRE = "CONECTAR-IA"


def _opciones_ssh(clave):
    # Sin contraseña como plan B: si la clave falla, que falle claro y no pida la de root.
    return [
        "-t", "-i", clave,
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no",
    ]


def contenido_cmd(ip, clave, usuario):
    """Lanzador de Windows (.cmd, CRLF). La clave con ruta absoluta y entre comillas."""
    remoto = "conectar-ia" + (" " + usuario if usuario else "")
    partes = ['"%s"' % a if a == clave else a for a in _opciones_ssh(clave)]
    lineas = [
        "@echo off",
        "chcp 65001 >nul",
        "title Conectar la IA de tu web con tu cuenta de Claude",
        "ssh " + " ".join(partes) + " root@" + ip + " " + remoto,
        "echo.",
        "echo Puedes cerrar esta ventana.",
        "pause >nul",
    ]
    return "\r\n".join(lineas) + "\r\n"


def contenido_command(ip, clave, usuario):
    """Lanzador de Mac (.command, se abre en Terminal con doble clic)."""
    remoto = "conectar-ia" + (" " + usuario if usuario else "")
    partes = ["'%s'" % a if a == clave else a for a in _opciones_ssh(clave)]
    lineas = [
        "#!/bin/bash",
        "# Conectar la IA de tu web con tu cuenta de Claude",
        "chmod 600 '%s' 2>/dev/null" % clave,
        "ssh " + " ".join(partes) + " root@" + ip + " " + remoto,
        "echo",
        "read -n 1 -s -r -p 'Pulsa una tecla para cerrar esta ventana...'",
        "echo",
    ]
    return "\n".join(lineas) + "\n"


def validar(ip, clave, usuario):
    try:
        ipaddress.ip_address(ip)
    except ValueError:
        if not re.fullmatch(r"[A-Za-z0-9.-]+", ip or ""):
            raise ValueError("La IP no es válida: %r" % ip)
    if not os.path.isfile(clave):
        raise ValueError("No encuentro la clave privada en %s" % clave)
    if "'" in clave or '"' in clave:
        raise ValueError("La ruta de la clave no puede llevar comillas: %s" % clave)
    if usuario and not re.fullmatch(r"[a-z_][a-z0-9_-]{0,30}", usuario):
        raise ValueError("Usuario de la app no válido: %r" % usuario)


def crear(ip, clave, usuario="", carpeta="."):
    clave = os.path.abspath(clave)
    validar(ip, clave, usuario)
    carpeta = os.path.abspath(carpeta)
    rutas = []
    for ext, texto in ((".cmd", contenido_cmd(ip, clave, usuario)),
                       (".command", contenido_command(ip, clave, usuario))):
        ruta = os.path.join(carpeta, NOMBRE + ext)
        with open(ruta, "w", encoding="utf-8", newline="") as fh:
            fh.write(texto)
        if ext == ".command":
            os.chmod(ruta, os.stat(ruta).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        rutas.append(ruta)
    return rutas


def main(argv=None):
    ap = argparse.ArgumentParser(description="Crea CONECTAR-IA.cmd y CONECTAR-IA.command en la carpeta del proyecto.")
    ap.add_argument("--ip", required=True, help="IP de la VPS (la de «Acceso root»)")
    ap.add_argument("--clave", required=True, help="clave privada, p. ej. secret/miapp_vps")
    ap.add_argument("--usuario", default="", help="usuario de la app en la VPS (opcional)")
    ap.add_argument("--dir", default=".", help="carpeta del proyecto (por defecto, la actual)")
    a = ap.parse_args(argv)
    try:
        for r in crear(a.ip, a.clave, a.usuario, a.dir):
            print(r)
    except ValueError as e:
        print("lanzadores-ia.py: %s" % e, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
