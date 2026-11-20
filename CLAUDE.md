# Lo Mismo Digo (ex Unánime): contexto del proyecto

Este archivo sirve para retomar el proyecto desde cualquier cuenta o sesión de Claude.
**Regla:** cada vez que se publica o actualiza el sitio, este archivo se actualiza en el mismo commit (sección "Historial de versiones" y lo que haya cambiado).

## Qué es

Juego web multijugador de palabras llamado **Lo Mismo Digo** (antes "Unánime"), inspirado en el juego de mesa Unánimo (tipo tutti frutti). Lo creó Cris (diseñadora UX/UI) para jugar con compañeros de trabajo por videollamada, cada uno desde su dispositivo. Es un proyecto de experimentación: no usa el design system Bioma.

- **Sitio:** https://ckorchik.github.io/lomismodigo/
- **Admin:** https://ckorchik.github.io/lomismodigo/admin.html (solo la cuenta de Google admin de Cris)
- **Repositorio:** https://github.com/ckorchik/lomismodigo (público)
- **Firebase:** proyecto "Lo Mismo Digo" (su ID técnico, `unanime123`, no se puede cambiar), Realtime Database en us-central1, plan Spark (gratis)

## Cómo trabaja Cris (importante)

- No es desarrolladora. Necesita instrucciones paso a paso, de a una cosa por vez y con los botones exactos de cada pantalla.
- Prefiere iterar la propuesta antes de programar: primero se propone, se ajusta y recién después se construye.
- Respuestas concisas, sin documentación ni texto de más.
- Herramientas: Windows, VS Code con Live Server, GitHub Desktop (para commit y push).
- Antes de agregar documentación, preguntarle dónde va y con qué estado.

## Stack y archivos

HTML, CSS y JavaScript sin frameworks ni build. Firebase se carga por CDN (v10.12.2).

| Archivo | Qué tiene |
|---|---|
| `index.html` | Página del juego |
| `admin.html` | Panel de admin: partidas, jugadores, almas gemelas y trampas |
| `css/estilos.css` | Estilos compartidos |
| `js/app.js` | Toda la lógica del juego y sus pantallas |
| `js/admin.js` | Lógica del panel de admin |
| `js/puntaje.js` | Coincidencias, puntaje, palabras repetidas y almas gemelas (sin dependencias) |
| `js/marca.js` | Identidad: logo, ícono y destellos (SVG) |
| `js/temas.js` | Mazo de 40 temas propios, editable |
| `js/firebase-config.js` | Configuración pública de Firebase |
| `firebase-reglas.json` | Reglas de seguridad. `TU_MAIL_ADMIN` reemplaza al mail real, que solo está en la consola de Firebase |

## Reglas del juego (modo Clásico)

- Se juega con **3 jugadores como mínimo**.
- Una partida tiene **2 rondas de 3 categorías** (6 temas en total).
- En cada categoría, cada jugador escribe **6 palabras** sobre el tema. No puede repetir palabras en su propia lista.
- **Puntaje:** cada palabra suma tantos puntos como jugadores la escribieron. Si nadie más la escribió, vale 0. Se aceptan plurales, tildes y sinónimos, pero no subcategorías.
- **Revisión:** se recorren las listas jugador por jugador. Los demás pueden tocar "💬 Lo mismo digo" para vincular un sinónimo propio.
- **Objeciones ("¿Será?"):** cualquiera toca el botón "¿Será?" sobre una persona puntual. El anfitrión resuelve solo para esa persona: ✅ vale, ❌ no vale (vale 0) o 🚨 trampa (vale 0 y −3 puntos). No se puede avanzar con objeciones pendientes.
- Después de cada categoría, todos ven la tabla con las palabras y los puntos de cada jugador, más el acumulado. Al cerrar cada ronda se muestra un subtotal, y al terminar, el ranking final.
- **Almas gemelas:** mención especial (no suma puntos) para la pareja que más coincidió, si se destaca (3 o más coincidencias y sin empate). Se muestra con chistes de detective, WhatsApp y Slack.
- **Ajustes de la sala** (los elige el anfitrión en la sala de espera):
  - **Fin de categoría:** cuando terminan todos, o por tiempo (de 1 a 10 minutos, con reloj; si todos terminan antes, se cierra igual).
  - **Elección de categoría:** el anfitrión (al azar del mazo o tema propio), o por turnos (a cada jugador le aparece un modal para proponer, con la opción "Sorteame una"; el anfitrión puede saltar el turno).
- Los modos Cronómetro, Iniciales prohibidas, Idioma y Equipos aparecen con 🔒 "Próximamente" y todavía no están desarrollados.

## Acceso y seguridad

- Los jugadores entran con autenticación anónima de Firebase, más un nombre y la **clave del equipo**.
- La clave está en `/claves/{clave}: true`. No es legible y se cambia desde la consola de Firebase; al cambiarla, todos tienen que volver a ingresarla.
- El admin entra con Google, y su mail está fijado en las reglas.
- Las palabras de los demás no se pueden leer mientras la categoría está abierta (lo controlan las reglas).
- Para que funcione el login de Google, `ckorchik.github.io` tiene que estar en Authentication → Dominios autorizados.

## Modelo de datos (Realtime Database)

- `miembros/{uid}`: nombre, clave, alta, ultimaVez
- `salas/{CODIGO}`: anfitrion, modo, estado (`espera`, `tema`, `escribiendo`, `revision`, `tabla`, `final`), catIndex, catKey (string), partida (string), turno, ajustes `{fin, minutos, eleccion}`, jugadores, guardado
  - `cats/{i}`: tema, por, proponente, propuesta/{uid}, finEn, listos/{uid}, vinculos/{uid}/{idx}: `{u, i}`, objeciones/{uid_idx}/{objetor}, resoluciones/{uid_idx}
- `respuestas/{CODIGO}/{partida}/{i}/{uid}`: palabras[6]
- `historial/{id}`: fecha, sala, ajustes, temas, jugadores (total, rondas, gano, trampas), ganadores, almasGemelas

## Cómo publicar

1. Si cambian las reglas, primero se pegan en Firebase (Realtime Database → Reglas, con el mail admin real) y se publican.
2. En GitHub Desktop: escribir un Summary, Commit to main y después Push origin. GitHub Pages se actualiza en uno o dos minutos.
3. Actualizar este archivo en el mismo commit.

Para probar en local: VS Code → Go Live, y ventanas de incógnito o de otro navegador para los demás jugadores (se necesitan 3).

## Identidad visual (definida)

- **Nombre:** Lo Mismo Digo. Tagline: "El juego donde ganás si pensás igual."
- **Logo:** dos burbujas de diálogo superpuestas. "lo mismo" va en una burbuja vacía con contorno (tu respuesta) y "digo" en una burbuja coral llena con colita (la coincidencia), más destellos lima y una etiqueta "+3". Está en `js/marca.js`. Referencia: artifact "Propuestas de logo — juego de coincidencias".
- **Colores:** crema `#FBF3E8` (fondo), tinta `#17142B`, coral `#FF5B4A`, lima `#D5F04B`, lavanda `#C9B8F5`, rosa `#FF9CCB`, celeste `#8FD3FF`.
- **Tipografía:** Bricolage Grotesque, 500 para texto y 800 para títulos.
- **Estilo:** formas de píldora, bordes de 3px en tinta, botón principal en tinta que pasa a lima con sombra desplazada al hacer hover, inputs con foco lima, y la tarjeta del tema como burbuja coral.
- **Textos clave:** "Lo mismo digo" (sumarse con un sinónimo) y "¿Será?" (objetar).

## Pendientes y decisiones abiertas

- **Dominio y marca:** si se monetiza, conviene un dominio propio con el nombre nuevo. Antes de registrar "Lo Mismo Digo" como marca, verificar en el INPI que esté disponible.
- **Monetización (idea):** GitHub Pages no permite uso comercial y AdSense pide dominio propio. Haría falta un dominio propio, hosting comercial (Netlify, Vercel o Cloudflare Pages) y quizás el plan Blaze de Firebase.
- **Protección:** agregar `LICENSE` con "Todos los derechos reservados". Opcionalmente, registrar el software en la DNDA y la marca en el INPI.

## Historial de versiones

- **v1 (2026-11-20):** primera versión del modo Clásico: salas con código, clave del equipo, revisión con "Yo también", tablas por categoría, ranking final, histórico y panel de admin.
- **v2 (2026-11-20):** ajustes de sala (por tiempo y categoría por turnos), palabras protegidas hasta el cierre, objeciones con penalidad por trampa, almas gemelas y bloqueo de palabras repetidas. Requiere las reglas nuevas.
- **v2.1 (2026-11-20):** mínimo de 3 jugadores para empezar la partida.
- **v3 (2026-11-20):** nueva identidad "Lo Mismo Digo": logo de burbujas, paleta, tipografía y favicon. "Yo también" pasa a "Lo mismo digo" y la objeción pasa a "¿Será?". El reloj ya no suma 1,5 s extra en pantalla. El repositorio pasa a llamarse `lomismodigo` (cambia el link del sitio).
- **v3.1 (2026-11-20):** más espacio entre el logo y la frase de la pantalla de entrada (en desktop se pisaban).
- **v3.2 (2026-11-20):** las tarjetas de las pantallas de entrada e inicio son más angostas y siguen los anchos de la grilla de Bootstrap (clase `.col-inicio`).
