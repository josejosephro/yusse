# Yussè Clip — runbook

## Estado (24-11-2026)
- Plan aprobado (`replica/PLAN.md`). Marca: **Yussè Clip** (repo: **Yusse**). IA: **sí** (Claude con la cuenta del usuario).
- App construida y probada en local, en `app/`.
- **Pendiente: publicar en la VPS.** La sesión en la nube no puede abrir SSH, así que hay que hacerlo desde la app de Claude en el ordenador del usuario.

## VPS (Hostinger)
- IP: 89.116.147.67 · usuario root.
- El nombre de host `srvXXXXXXX.hstgr.cloud` se saca con `hostname -f` una vez dentro.
- La clave de esta sesión en la nube se pierde. Hay que generar una nueva en el ordenador del usuario y que la pegue en hPanel › VPS › Clave SSH.

## Publicar desde la consola de hPanel (sin SSH)
Con el repo en público, pegar como root en hPanel › VPS › Terminal del navegador:
`apt-get update -qq && apt-get install -y -qq git && (git -C /root/yusse-src pull -q 2>/dev/null || git clone -q --depth 1 https://github.com/josejosephro/yusse /root/yusse-src) && bash /root/yusse-src/app/deploy/publicar.sh`
`publicar.sh` revisa lo que ya hay, instala la app, configura nginx (raíz o /yusse/), pone el candado y prepara la IA. Registro: /root/yusse-publicar.log.

## Publicar (desde el ordenador del usuario)
1. Comprobar qué hay ya en la VPS sin tocar nada: `hostname -f; ss -ltnp; ls /etc/nginx/sites-enabled; grep -rl connection_upgrade /etc/nginx`. Elegir un puerto libre (3070 por defecto).
2. Subir el código: `scp -r app root@IP:/tmp/yusse-src` (sin `node_modules` ni `data`).
3. Instalar: `ssh root@IP "bash /tmp/yusse-src/deploy/instalar-en-vps.sh 3070"`.
4. Configurar nginx con `deploy/nginx-yusse.conf`:
   - Sustituir HOST.
   - Si ese host ya sirve otro proyecto, usar la variante subcarpeta `/yusse/`.
   - Si ya existe el `map` de `connection_upgrade`, no repetirlo.
   - Ejecutar `nginx -t` y recargar nginx.
5. Candado: `certbot --nginx -d HOST --non-interactive --agree-tos --register-unsafely-without-email --redirect`.
6. IA: `instalar-ia.sh yusse` (script de la skill). Después el usuario ejecuta `conectar-ia` e inicia sesión. Comprobar `sudo -u yusse claude auth status`.
7. Verificar: `curl -I https://HOST/` debe dar 200, `/api/health` debe responder `"ai":true`, y una subida real debe completarse (transcripción local).
