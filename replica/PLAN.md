# PLAN · «Yussè Clip» — recortes de vídeo con IA, gratis y con hilo narrativo

> Estado: **APROBADO** (24-11-2026) · con IA · marca final «Yussè Clip» · repositorio «Yusse».

## 1. Qué hace y para quién
Subes un vídeo largo (o pegas un enlace) y la app saca automáticamente los mejores
momentos como clips verticales con subtítulos, listos para TikTok, Reels, Shorts y LinkedIn.
Sirve para cualquier tema: clases, empresa, eventos, pódcasts, videojuegos…
**Todo gratis**: sin planes, sin créditos, sin marca de agua y sin caducidad.

## 2. Cómo funciona la referencia (lo que entendí)
Fuente: documentación pública y reseñas. No pude abrir la web original desde este entorno, así que **no hay capturas**.
- Entrada: enlace (YouTube y similares) o archivo propio.
- Opciones antes de recortar: duración de clip, rango de tiempo del vídeo, temas o instrucción escrita, idioma.
- Resultados: lista de clips con **puntuación de viralidad** (gancho, ritmo, valor, tendencia) y transcripción.
- Editor: subtítulos animados con plantillas, edición por texto y por línea de tiempo, reencuadre automático al hablante, kit de marca (logo, colores, fuente, intro y cierre), quitar muletillas, títulos generados.
- Publicación: calendario y envío a redes. Equipos de trabajo. Pago por créditos (lo eliminamos).

## 3. Mapa de pantallas (recorrido principal ➜)
1. **Portada** — qué es, botón «Empieza gratis».
2. **Entrar / Crear cuenta** — correo y contraseña.
3. **Mis proyectos** — tarjetas con miniatura, estado y nº de clips.
4. **Nuevo proyecto** ➜ enlace o archivo · modo **Clips** o **Hilo narrativo** · duración (15–30 s, 30–60 s, 60–90 s, auto) · tramo del vídeo · instrucción («los momentos graciosos», «la explicación del producto») · idioma.
5. **Procesando (en directo)** ➜ barra y pasos en tiempo real: descargando, transcribiendo, eligiendo momentos, montando.
6. **Resultados** ➜ clips ordenados por puntuación (con el porqué de la nota), filtros, descargar todos.
7. **Editor de clip** ➜ vista vertical, transcripción editable, recortar inicio y fin, encuadre (9:16, 1:1, 16:9, seguir la cara), estilos de subtítulo, emojis, quitar muletillas, velocidad, onda de audio visible, título y gancho.
8. **Hilo narrativo** ➜ las 3 partes en carrusel, puntos de corte ajustables, textos de suspense y llamada a la acción editables.
9. **Kit de marca** — logo, colores, fuente, cierre.
10. **Calendario** — planificar qué clip sale qué día y en qué red, con el texto del post listo para copiar.
11. **Ajustes / Equipo** — invitar compañeros a un espacio compartido.

## 4. Modo «Hilo narrativo» (la novedad)
Convierte una anécdota o explicación de unos 3 minutos en **Parte 1 → 2 → 3**:
1. Busca en el vídeo un bloque con historia completa (planteamiento, nudo, desenlace), o usa el tramo que tú marques.
2. Lo divide en 3 partes de duración parecida, pero **corta solo en finales de frase** y elige el punto de máxima tensión: justo antes de una revelación, tras una pregunta o un «pero…» o «y entonces…».
3. Añade a cada parte:
   - Una etiqueta **«1/3»** fija arriba.
   - **Cliffhanger visual** al final: congela la imagen y muestra un texto de suspense generado («No te imaginas lo que respondió…»).
   - **Tarjeta final de 2 s**: «▶ Parte 2 en mi perfil» con flecha animada.
   - En las partes 2 y 3, un **«Antes…»** de una línea al inicio.
4. Genera títulos numerados y el texto de publicación de cada parte, en orden, para el calendario.

## 5. Mejoras sacadas de las reseñas (lo que al original le falta)
| Queja frecuente | Qué hace Yussè Clip |
|---|---|
| La IA corta mal o se salta el momento que quieres | **Clip a mano desde la transcripción**: seleccionas frases y creas el clip al instante |
| Cobros, créditos y caducidades | **Gratis**: sin límites artificiales, sin marca de agua, sin caducidad de 3 días |
| Proyectos perdidos por fallos | **Autoguardado con historial**: vuelves a cualquier versión |
| No se puede acelerar ni unir clips; la onda de audio no se ve | **Velocidad**, **unir clips** y **onda visible** en el editor |
| No entiendes por qué un clip tiene buena nota | **Nota explicada** (gancho, ritmo, valor, cierre) |

## 6. Modelo de datos
- **Usuario** (correo, contraseña cifrada, nombre)
- **Espacio** (equipo) y **Miembro**
- **Proyecto** (fuente: enlace o archivo, opciones, estado, duración)
- **Transcripción** (palabras con tiempos, idioma)
- **Clip** (inicio, fin, nota y desglose, título, gancho, encuadre, estilo de subtítulos, velocidad, versión)
- **Hilo** → **Parte** (orden, inicio, fin, texto de suspense, llamada a la acción, «antes…»)
- **Kit de marca** (logo, colores, fuente, cierre)
- **Trabajo** (pasos y progreso en directo)
- **Publicación planificada** (clip, red, fecha, texto)

## 7. Cómo se construye (stack)
- Servidor **Node.js** con **tiempo real por websockets** para el progreso en directo.
- Base de datos **SQLite** (un archivo en tu VPS, sin coste).
- Vídeo: **ffmpeg** (cortar, reencuadrar, subtítulos quemados, tarjetas) y detección de caras para seguir al hablante.
- Transcripción: **Whisper**, funciona dentro de tu VPS, gratis y en +90 idiomas.
- Enlaces: importación desde YouTube y similares (vídeos públicos).
- Publicación: tu VPS, en `https://srvXXXXXXX.hstgr.cloud` (o en una subcarpeta si ya hay algo), con candado HTTPS, sin tocar lo que ya tengas.
- Código guardado en un repositorio nuevo de tu GitHub (`Yusse`).

## 8. Funciones de IA (con tu cuenta de Claude, sin coste extra)
1. Elegir los mejores momentos y poner la nota explicada.
2. Diseñar los cortes y textos de suspense del **Hilo narrativo**.
3. Títulos, ganchos y texto de publicación para cada red.
4. Encontrar momentos con tu instrucción escrita.

Sin IA funciona con reglas automáticas (pausas, energía de la voz, frases clave), pero elige peor y los suspenses son más genéricos.

## 9. Marca propia
- **Nombre: Yussè Clip** (elegido por el usuario).
- **Paleta**: tinta ciruela `#1B1630` (fondo), crema `#FFF7EC`, coral `#FF5A36` (acción), ámbar `#FFB020` (resaltes), menta suave `#3DD6B0` (éxito).
- **Tipografía**: «Bricolage Grotesque» para titulares y «Inter» para textos.
- **Tono**: cercano, de tú, con chispa narrativa («Tu vídeo largo tiene cien historias. Yussè las encuentra.»).

## 10. Tiempo y coste
- **Construcción**: la hago yo en esta sesión (del orden de un día de trabajo), probada en local.
- **Coste de funcionamiento**: 0 € extra; solo tu VPS. La IA usa tu cuenta de Claude.
- **Recomendación de VPS**: transcribir y montar vídeo exige máquina. Con 8 GB de RAM (KVM 2 o superior) va bien. Con menos funciona, pero más lento. Lo compruebo al conectar.
- **Fuera de esta primera versión**: publicar *automáticamente* en TikTok, Instagram y YouTube, porque cada red exige aprobar una app de desarrollador (semanas). De momento, calendario más descarga y texto listo para copiar.
- **Publicación**: pendiente de conectar la VPS desde la app de Claude de tu ordenador.
