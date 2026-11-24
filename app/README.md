# Yussè Clip

Convierte vídeos largos en clips verticales con subtítulos animados, y en **hilos narrativos**: series de 3 partes con suspense y la llamada «▶ Parte 2 en mi perfil». Es gratis y vale para cualquier tema.

## Qué incluye
- **Entrada:** enlace público (YouTube, Vimeo…) o archivo de hasta 4 GB, con progreso en directo por websockets.
- **Opciones:** duración del clip, tramo del vídeo, instrucción escrita («los momentos graciosos»), idioma y uso de IA.
- **Clips con nota explicada:** gancho, ritmo, valor y cierre.
- **Hilo narrativo:** busca una historia de unos 3 minutos y la corta en 3 partes justo antes de cada revelación. Cada parte lleva etiqueta 1/3, imagen congelada con frase de suspense, tarjeta «Parte N en mi perfil» y un «Antes…». Los cortes se pueden ajustar frase a frase.
- **Editor:** 5 estilos de subtítulos, color, posición y tamaño; formatos 9:16, 1:1, 4:5 y 16:9; encuadre que sigue la cara, centrado o plano completo con fondo difuminado; velocidad; quitar muletillas; forma de onda con bordes arrastrables; corrección de palabras.
- **Mejoras sobre la referencia:** clip a mano desde la transcripción, unir clips, autoguardado con historial de versiones, nota explicada, gratis y sin caducidad.
- **Kit de marca** (logo, colores, tipografía, @usuario, tarjeta de cierre), **calendario** con textos de publicación generados por IA, y **equipos** con enlace de invitación.

## Cómo funciona por dentro
- Servidor Node (Express y websockets) con base de datos SQLite.
- ffmpeg (con libass) para montar los clips.
- faster-whisper para transcribir y OpenCV para detectar caras.
- yt-dlp para importar enlaces.
- IA: Claude Code instalado en el servidor, con la cuenta del propietario. Si no está conectado, la app usa reglas automáticas.

## Arrancar en local
```bash
npm ci
pip install faster-whisper opencv-python-headless yt-dlp
node server/index.js     # http://127.0.0.1:3070
```
Variables: `PORT`, `DATA_DIR`, `WHISPER_MODEL` (base/small/medium), `PYTHON_BIN`, `YTDLP_BIN`, `AI_ENABLED=0` (para desactivar la IA) y `COOKIE_SECURE=1` (detrás de HTTPS).

## Publicar en la VPS
Ver `deploy/instalar-en-vps.sh` y `deploy/nginx-yusse.conf`. Los pasos completos están en `../CLAUDE.md`.
