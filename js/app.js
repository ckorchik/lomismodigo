import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update, remove, push, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { auth, db, configurado } from "./firebase.js";
import { TEMAS } from "./temas.js";
import { calcularCategoria, almasGemelas, repetidas, PENALIDAD_TRAMPA } from "./puntaje.js";

const RONDAS = 2;
const CATS_POR_RONDA = 3;
const TOTAL_CATS = RONDAS * CATS_POR_RONDA;
const MIN_JUGADORES = 2;
const AJUSTES_BASE = { fin: "todos", minutos: 2, eleccion: "anfitrion" };

const MODOS = [
  { id: "clasico", nombre: "Clásico", desc: "6 palabras por tema. Sumás puntos coincidiendo con los demás.", activo: true },
  { id: "cronometro", nombre: "Cronómetro", desc: "Solo 1 minuto para escribir las 6 palabras." },
  { id: "iniciales", nombre: "Iniciales prohibidas", desc: "No vale usar palabras que empiecen con 5 letras sorteadas." },
  { id: "idioma", nombre: "Idioma", desc: "Se juega en otro idioma que manejen todos." },
  { id: "equipos", nombre: "Equipos", desc: "Dos equipos eligen juntos sus 6 palabras. Ideal para 8 o más." },
];

const CHISTES_ALMAS = [
  (a, b, n) => `${a} y ${b} coincidieron en ${n} palabras. El detective pidió ver el chat de WhatsApp… dicen que "solo hablaban del clima" 🔍`,
  (a, b, n) => `${n} coincidencias entre ${a} y ${b}. La lupa encontró un canal de Slack llamado #nada-sospechoso 🕵️`,
  (a, b, n) => `${a} y ${b}: ${n} palabras iguales. El detective jura que escuchó un "jaja sí, poné esa" en la videollamada 👀`,
  (a, b, n) => `${a} y ${b} piensan igual (${n} veces). O comparten neurona, o comparten grupo de WhatsApp. El caso sigue abierto 🔎`,
  (a, b, n) => `Con ${n} coincidencias, ${a} y ${b} se llevan la mención especial. El detective revisó Slack: solo había stickers 🕵️‍♀️`,
];

const $app = document.getElementById("app");
const S = {
  uid: null, nombre: "", pantalla: "cargando", error: "",
  codigo: null, sala: null, desuscribir: null, claveRender: "",
  modo: "clasico", sugerencia: null, picker: null, borrador: null, guardarTimer: null,
  offset: 0, resp: {}, subs: {}, partidaResp: null, propuestaTxt: "", cerrando: false, tiempoAgotado: false,
};

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const logo = (clase) => `<div class="logo ${clase}"><span>un<span class="acento">á</span>nime</span><span class="burbuja">✓</span></div>`;
const denegado = (e) => String(e && (e.code || e.message)).toLowerCase().includes("permission");
const ahora = () => Date.now() + S.offset;
const jugadoresOrden = (sala) => Object.entries(sala.jugadores || {})
  .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0) || a[0].localeCompare(b[0]))
  .map(([uid]) => uid);
const nombreDe = (uid) => esc(S.sala?.jugadores?.[uid]?.nombre || "?");
const soyAnfitrion = () => S.sala && S.sala.anfitrion === S.uid;
const ajustes = () => ({ ...AJUSTES_BASE, ...(S.sala?.ajustes || {}) });
const salaRef = (p = "") => ref(db, `salas/${S.codigo}${p ? "/" + p : ""}`);
const respRef = (i, uid) => ref(db, `respuestas/${S.codigo}/${S.sala.partida}/${i}${uid ? "/" + uid : ""}`);
const catActual = () => S.sala.cats?.[S.sala.catIndex] || {};

function generarCodigo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letras[Math.floor(Math.random() * letras.length)]).join("");
}

function setUrlSala(codigo) {
  const url = new URL(location.href);
  if (codigo) url.searchParams.set("sala", codigo); else url.searchParams.delete("sala");
  history.replaceState(null, "", url);
}

function temaAlAzar(evitar) {
  const usados = new Set(Object.values(S.sala?.cats || {}).map((c) => c?.tema));
  const libres = TEMAS.filter((t) => !usados.has(t) && t !== evitar);
  const lista = libres.length ? libres : TEMAS;
  return lista[Math.floor(Math.random() * lista.length)];
}

// Categoría con las respuestas que ya se pueden leer
function datosCat(i) {
  return { ...(S.sala.cats?.[i] || {}), respuestas: S.resp[i] || {} };
}

// Puntos por categoría (solo las cerradas) y acumulados
function puntajes(sala) {
  const orden = jugadoresOrden(sala);
  const porCat = [];
  const cerradaHasta = ["tabla", "final"].includes(sala.estado) ? sala.catIndex : sala.catIndex - 1;
  for (let i = 0; i <= cerradaHasta && i < TOTAL_CATS; i++) porCat[i] = calcularCategoria(datosCat(i), orden);
  const tot = {};
  for (const uid of orden) {
    const rondas = Array(RONDAS).fill(0);
    porCat.forEach((c, i) => { if (c) rondas[Math.floor(i / CATS_POR_RONDA)] += c[uid]?.total || 0; });
    tot[uid] = { rondas, total: rondas.reduce((a, b) => a + b, 0) };
  }
  return { orden, porCat, tot };
}

// ---------- respuestas (protegidas: las ajenas solo se leen cuando la categoría cerró) ----------
function sincronizarRespuestas() {
  const s = S.sala;
  if (S.partidaResp !== s.partida) {
    Object.values(S.subs).forEach((u) => u());
    S.subs = {}; S.resp = {}; S.partidaResp = s.partida;
  }
  for (let i = 0; i <= s.catIndex && i < TOTAL_CATS; i++) {
    const legible = i < s.catIndex || !["escribiendo", "tema"].includes(s.estado);
    if (!legible || S.subs[i]) continue;
    S.subs[i] = onValue(respRef(i), (snap) => {
      const v = snap.val() || {};
      S.resp[i] = Object.fromEntries(Object.entries(v).map(([u, r]) => [u, Array.from({ length: 6 }, (_, k) => r?.palabras?.[k] || "")]));
      render();
    }, () => { delete S.subs[i]; });
  }
}

// ---------- arranque ----------
async function iniciar() {
  if (!configurado) {
    $app.innerHTML = `${logo("logo-grande")}<div class="card"><h2>Falta configurar Firebase</h2><p>Pegá tu <code>firebaseConfig</code> en <code>js/firebase-config.js</code>.</p></div>`;
    return;
  }
  onValue(ref(db, ".info/serverTimeOffset"), (s) => { S.offset = s.val() || 0; });
  onAuthStateChanged(auth, async (user) => {
    if (!user) { signInAnonymously(auth).catch((e) => mostrarError(e)); return; }
    if (S.uid === user.uid) return;
    S.uid = user.uid;
    await verificarMiembro();
  });
  setInterval(tic, 250);
}

async function verificarMiembro() {
  try {
    const snap = await get(ref(db, `miembros/${S.uid}`));
    if (!snap.exists()) return irA("clave");
    S.nombre = snap.val().nombre || "";
    try {
      await get(ref(db, "salas/__prueba"));
    } catch (e) {
      if (denegado(e)) { S.error = "La clave del equipo cambió. Pedí la nueva."; return irA("clave"); }
      throw e;
    }
    update(ref(db, `miembros/${S.uid}`), { ultimaVez: serverTimestamp() }).catch(() => {});
    const codigo = new URLSearchParams(location.search).get("sala");
    if (codigo) return unirse(codigo.toUpperCase());
    irA("inicio");
  } catch (e) { mostrarError(e); }
}

function mostrarError(e) {
  console.error(e);
  $app.innerHTML = `${logo("logo-grande")}<div class="card"><h2>Algo salió mal</h2><p class="muted">${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`;
}

function irA(pantalla) {
  S.pantalla = pantalla;
  S.claveRender = "";
  render();
}

// ---------- pantallas sin sala ----------
function pantallaClave() {
  return `
    ${logo("logo-grande")}
    <p class="muted">El juego de pensar igual que los demás.</p>
    <div class="card">
      <h2>Entrá al equipo</h2>
      <p class="muted">Pedile la clave a quien te pasó el link. Solo te la pedimos una vez.</p>
      ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
      <form id="f-clave">
        <label for="nombre">Tu nombre</label>
        <input type="text" id="nombre" maxlength="20" required value="${esc(S.nombre)}" autocomplete="given-name">
        <label for="clave">Clave del equipo</label>
        <input type="text" id="clave" required autocomplete="off">
        <div style="margin-top:18px"><button class="btn coral full" type="submit">Entrar</button></div>
      </form>
    </div>`;
}

function bindClave() {
  document.getElementById("f-clave").onsubmit = async (ev) => {
    ev.preventDefault();
    const nombre = document.getElementById("nombre").value.trim();
    const clave = document.getElementById("clave").value.trim();
    if (!nombre || !clave) return;
    if (/[.#$\[\]\/]/.test(clave)) { S.error = "Clave incorrecta."; return render(); }
    try {
      await set(ref(db, `miembros/${S.uid}`), { nombre, clave, alta: serverTimestamp(), ultimaVez: serverTimestamp() });
      S.nombre = nombre; S.error = "";
      verificarMiembro();
    } catch (e) {
      S.nombre = nombre;
      S.error = denegado(e) ? "Clave incorrecta." : e.message;
      render();
    }
  };
}

function pantallaInicio() {
  return `
    ${logo("logo-grande")}
    <p class="muted">El juego de pensar igual que los demás.</p>
    ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
    <div class="card">
      <label for="nombre" style="margin-top:0">Jugás como</label>
      <input type="text" id="nombre" maxlength="20" value="${esc(S.nombre)}">
      <div style="margin-top:18px"><button class="btn coral full" id="b-crear">Crear sala</button></div>
    </div>
    <div class="card">
      <h3>¿Te pasaron un código?</h3>
      <form id="f-unirse" class="fila">
        <input class="crece" type="text" id="codigo" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:.2em;flex:1;width:auto">
        <button class="btn menta" type="submit">Unirme</button>
      </form>
    </div>
    <div class="pie">Inspirado en los juegos de palabras de toda la vida.</div>`;
}

async function guardarNombre() {
  const n = document.getElementById("nombre").value.trim();
  if (n && n !== S.nombre) {
    S.nombre = n;
    await update(ref(db, `miembros/${S.uid}`), { nombre: n }).catch(() => {});
  }
  return !!S.nombre;
}

function bindInicio() {
  document.getElementById("b-crear").onclick = async () => {
    if (!(await guardarNombre())) return;
    S.error = ""; irA("modos");
  };
  document.getElementById("f-unirse").onsubmit = async (ev) => {
    ev.preventDefault();
    if (!(await guardarNombre())) return;
    const c = document.getElementById("codigo").value.trim().toUpperCase();
    if (c.length === 4) unirse(c);
  };
}

function pantallaModos() {
  return `
    <div class="barra"><button class="btn blanco chico" id="b-volver">← Volver</button></div>
    <h2>Elegí el modo de juego</h2>
    <p class="muted">${RONDAS} rondas de ${CATS_POR_RONDA} categorías cada una. Los ajustes los elegís en la sala.</p>
    <div class="modos">
      ${MODOS.map((m) => `
        <button class="modo ${m.activo ? (S.modo === m.id ? "activo" : "") : "bloqueado"}" data-modo="${m.id}" ${m.activo ? "" : 'aria-disabled="true"'}>
          <h3>${m.activo ? "" : "🔒 "}${m.nombre}</h3>
          <p>${m.desc}</p>
          ${m.activo ? "" : '<span class="etiqueta">Próximamente</span>'}
        </button>`).join("")}
    </div>
    ${S.error ? `<div class="error">${esc(S.error)}</div>` : ""}
    <div style="margin-top:24px"><button class="btn coral full" id="b-crear">Crear sala</button></div>`;
}

function bindModos() {
  document.getElementById("b-volver").onclick = () => irA("inicio");
  document.querySelectorAll(".modo").forEach((b) => {
    b.onclick = () => {
      const m = MODOS.find((x) => x.id === b.dataset.modo);
      if (m.activo) { S.modo = m.id; render(); }
    };
  });
  document.getElementById("b-crear").onclick = crearSala;
}

// ---------- sala ----------
async function crearSala() {
  try {
    let codigo;
    for (let i = 0; i < 10; i++) {
      codigo = generarCodigo();
      if (!(await get(ref(db, `salas/${codigo}`))).exists()) break;
    }
    await set(ref(db, `salas/${codigo}`), {
      anfitrion: S.uid, modo: S.modo, estado: "espera", catIndex: 0, catKey: "0", partida: "1", turno: 0,
      ajustes: AJUSTES_BASE, creada: serverTimestamp(),
      jugadores: { [S.uid]: { nombre: S.nombre, orden: Date.now() } },
    });
    escucharSala(codigo);
  } catch (e) { S.error = e.message; render(); }
}

async function unirse(codigo) {
  try {
    const snap = await get(ref(db, `salas/${codigo}`));
    if (!snap.exists()) throw new Error(`No existe la sala ${codigo}.`);
    const sala = snap.val();
    if (!sala.jugadores?.[S.uid]) {
      if (sala.estado !== "espera") throw new Error("Esa partida ya empezó. Esperá a la próxima.");
      await set(ref(db, `salas/${codigo}/jugadores/${S.uid}`), { nombre: S.nombre, orden: Date.now() });
    }
    escucharSala(codigo);
  } catch (e) {
    setUrlSala(null);
    S.error = e.message;
    irA("inicio");
  }
}

function escucharSala(codigo) {
  if (S.desuscribir) S.desuscribir();
  S.codigo = codigo; S.error = ""; S.pantalla = "sala"; S.claveRender = "";
  setUrlSala(codigo);
  S.desuscribir = onValue(ref(db, `salas/${codigo}`), (snap) => {
    if (!snap.exists() || !snap.val().jugadores?.[S.uid]) { salir(false); return; }
    S.sala = snap.val();
    sincronizarRespuestas();
    automatismosAnfitrion();
    render();
  }, (e) => mostrarError(e));
}

async function salir(avisar = true) {
  if (S.desuscribir) S.desuscribir();
  Object.values(S.subs).forEach((u) => u());
  S.desuscribir = null; S.subs = {}; S.resp = {}; S.partidaResp = null;
  if (avisar && S.sala && S.codigo) {
    if (soyAnfitrion() && S.sala.estado === "espera") await remove(salaRef()).catch(() => {});
    else if (S.sala.estado === "espera") await remove(salaRef(`jugadores/${S.uid}`)).catch(() => {});
  }
  S.sala = null; S.codigo = null; S.borrador = null;
  setUrlSala(null);
  irA("inicio");
}

// Pasar a elegir el tema de la categoría i
function cambiosEntrarTema(i, turno) {
  const c = { estado: "tema", catIndex: i, catKey: String(i), revisionTurno: null };
  if (ajustes().eleccion === "turnos") {
    const orden = jugadoresOrden(S.sala);
    c[`cats/${i}/proponente`] = orden[turno % orden.length];
    c.turno = turno + 1;
  }
  return c;
}

function iniciarEscritura(tema, por) {
  const i = S.sala.catIndex;
  const c = { estado: "escribiendo", [`cats/${i}/tema`]: tema, [`cats/${i}/por`]: por || null };
  if (ajustes().fin === "tiempo") c[`cats/${i}/finEn`] = ahora() + ajustes().minutos * 60000 + 1500;
  return update(salaRef(), c);
}

function cerrarCategoria() {
  if (S.cerrando) return;
  S.cerrando = true;
  update(salaRef(), { estado: "revision", revisionTurno: 0 }).finally(() => { S.cerrando = false; });
}

// El anfitrión hace avanzar el juego automáticamente
function automatismosAnfitrion() {
  const s = S.sala;
  if (!soyAnfitrion()) return;
  const cat = catActual();
  if (s.estado === "escribiendo") {
    const listos = cat.listos || {};
    if (jugadoresOrden(s).every((u) => listos[u])) cerrarCategoria();
  }
  if (s.estado === "tema" && ajustes().eleccion === "turnos" && cat.proponente) {
    const prop = cat.propuesta?.[cat.proponente];
    if (prop?.tema && !S.cerrando) {
      S.cerrando = true;
      iniciarEscritura(prop.tema, cat.proponente).finally(() => { S.cerrando = false; });
    }
  }
}

// Reloj: corre cada 250 ms
function tic() {
  const s = S.sala;
  if (!s || s.estado !== "escribiendo") return;
  const finEn = catActual().finEn;
  if (!finEn) return;
  const resta = finEn - ahora();
  const el = document.getElementById("reloj");
  if (el) {
    const seg = Math.max(0, Math.ceil(resta / 1000));
    el.textContent = `⏱ ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
    el.classList.toggle("urgente", seg <= 10);
  }
  if (resta <= 0 && !S.tiempoAgotado) {
    S.tiempoAgotado = true;
    if (S.borrador) guardarPalabras();
    actualizarEscribir();
  }
  if (resta <= -1500 && soyAnfitrion()) cerrarCategoria();
}

function barraSala({ marcador = true } = {}) {
  const s = S.sala;
  const ronda = Math.floor(s.catIndex / CATS_POR_RONDA) + 1;
  const cat = (s.catIndex % CATS_POR_RONDA) + 1;
  const prog = s.estado === "espera" ? "Sala de espera" : s.estado === "final" ? "Resultado final" : `Ronda ${ronda} · Categoría ${cat}/${CATS_POR_RONDA}`;
  let fichas = "";
  if (marcador && s.estado !== "espera") {
    const { orden, tot } = puntajes(s);
    fichas = `<div class="marcador">${orden.map((u) => `<span class="ficha ${u === S.uid ? "yo" : ""}">${nombreDe(u)}<b>${tot[u].total}</b></span>`).join("")}</div>`;
  }
  return `<div class="barra">${logo("logo-chico")}<span class="codigo">${esc(S.codigo)}</span></div>
    <div class="progreso">${prog}</div>${fichas}`;
}

// --- Espera
function textoAjustes(a) {
  return `${a.fin === "tiempo" ? `⏱ ${a.minutos} min por categoría` : "✋ Se cierra cuando terminan todos"} · ${a.eleccion === "turnos" ? "🔄 Categorías por turnos" : "👑 Elige el anfitrión"}`;
}

function pantallaEspera() {
  const s = S.sala;
  const orden = jugadoresOrden(s);
  const a = ajustes();
  const link = `${location.origin}${location.pathname}?sala=${S.codigo}`;
  const opcion = (campo, valor, texto) => `<button class="seg ${a[campo] === valor ? "on" : ""}" data-campo="${campo}" data-valor="${valor}">${texto}</button>`;
  const panelAjustes = soyAnfitrion() ? `
      <label>¿Cuándo termina cada categoría?</label>
      <div class="segmentado">${opcion("fin", "todos", "✋ Cuando terminan todos")}${opcion("fin", "tiempo", "⏱ Por tiempo")}</div>
      ${a.fin === "tiempo" ? `<div class="fila" style="margin-top:10px"><button class="btn blanco chico" id="b-menos" ${a.minutos <= 1 ? "disabled" : ""}>−</button>
        <b style="min-width:90px;text-align:center">${a.minutos} ${a.minutos === 1 ? "minuto" : "minutos"}</b>
        <button class="btn blanco chico" id="b-mas" ${a.minutos >= 10 ? "disabled" : ""}>+</button></div>` : ""}
      <label>¿Quién elige la categoría?</label>
      <div class="segmentado">${opcion("eleccion", "anfitrion", "👑 El anfitrión")}${opcion("eleccion", "turnos", "🔄 Por turnos")}</div>`
    : `<p>${textoAjustes(a)}</p>`;
  return `${barraSala()}
    <div class="card" style="text-align:center">
      <p class="muted">Compartí este código con tu equipo</p>
      <span class="codigo codigo-grande">${esc(S.codigo)}</span>
      <div style="margin-top:14px"><button class="btn blanco chico" id="b-link" data-link="${esc(link)}">Copiar link de invitación</button></div>
    </div>
    <div class="card">
      <h3>Jugadores (${orden.length})</h3>
      <div class="jugadores">${orden.map((u) => `<span class="ficha ${u === S.uid ? "yo" : ""}">${nombreDe(u)}${u === s.anfitrion ? " 👑" : ""}</span>`).join("")}</div>
    </div>
    <div class="card">
      <h3>Ajustes de la partida</h3>
      <p class="muted" style="margin:0">Modo: ${esc(MODOS.find((m) => m.id === s.modo)?.nombre || "Clásico")}</p>
      ${panelAjustes}
    </div>
    ${soyAnfitrion()
      ? `<button class="btn coral full" id="b-empezar" ${orden.length < MIN_JUGADORES ? "disabled" : ""}>${orden.length < MIN_JUGADORES ? `Esperando jugadores (mínimo ${MIN_JUGADORES})` : "¡Empezar partida!"}</button>`
      : `<p class="espera muted">Esperando a que ${nombreDe(s.anfitrion)} empiece la partida…</p>`}
    <div style="margin-top:18px"><button class="btn blanco chico" id="b-salir">Salir de la sala</button></div>`;
}

function bindEspera() {
  const bl = document.getElementById("b-link");
  bl.onclick = async () => {
    try { await navigator.clipboard.writeText(bl.dataset.link); bl.textContent = "¡Link copiado!"; }
    catch { prompt("Copiá este link:", bl.dataset.link); }
  };
  document.getElementById("b-salir").onclick = () => salir(true);
  if (!soyAnfitrion()) return;
  document.querySelectorAll(".seg").forEach((b) => b.onclick = () => update(salaRef("ajustes"), { [b.dataset.campo]: b.dataset.valor }));
  const mm = (d) => update(salaRef("ajustes"), { minutos: Math.min(10, Math.max(1, ajustes().minutos + d)) });
  document.getElementById("b-menos")?.addEventListener("click", () => mm(-1));
  document.getElementById("b-mas")?.addEventListener("click", () => mm(1));
  const be = document.getElementById("b-empezar");
  if (be) be.onclick = () => update(salaRef(), { cats: null, guardado: null, ...cambiosEntrarTema(0, 0) });
}

// --- Elegir tema
function pantallaTema() {
  const s = S.sala;
  const cat = catActual();
  if (ajustes().eleccion === "turnos") {
    const prop = cat.proponente;
    if (prop === S.uid) {
      return `${barraSala()}
        <div class="modal-fondo"><div class="modal">
          <div class="podio">💡</div>
          <h2>¡Te toca proponer la categoría!</h2>
          <p class="muted">Pensá un tema con muchas respuestas posibles.</p>
          <form id="f-propuesta">
            <input type="text" id="propuesta" maxlength="70" placeholder="Ej: Cosas que hay en una oficina" value="${esc(S.propuestaTxt)}" autocomplete="off">
            <div class="fila" style="margin-top:14px">
              <button class="btn blanco" type="button" id="b-sortear">🎲 Sorteame una</button>
              <button class="btn coral crece" type="submit">Proponer</button>
            </div>
          </form>
        </div></div>`;
    }
    return `${barraSala()}<div class="card espera"><div class="podio">💭</div><h2>${nombreDe(prop)} está pensando la categoría…</h2>
      ${soyAnfitrion() ? `<button class="btn blanco chico" id="b-saltar">Saltar turno</button>` : ""}</div>`;
  }
  if (!soyAnfitrion()) {
    return `${barraSala()}<div class="card espera"><h2>Preparando la categoría…</h2><p class="muted">${nombreDe(s.anfitrion)} está eligiendo el tema.</p></div>`;
  }
  if (!S.sugerencia) S.sugerencia = temaAlAzar();
  return `${barraSala()}
    <h2>Elegí el tema</h2>
    <div class="tema"><small>Tema sugerido</small>${esc(S.sugerencia)}</div>
    <div class="fila">
      <button class="btn blanco" id="b-otro">🔀 Otro tema</button>
      <button class="btn coral crece" id="b-usar">Usar este tema</button>
    </div>
    <div class="card">
      <h3>…o escribí uno propio</h3>
      <form id="f-propio" class="fila">
        <input type="text" id="propio" class="crece" maxlength="70" placeholder="Ej: Cosas que hay en la oficina" style="flex:1;width:auto">
        <button class="btn menta" type="submit">Usar</button>
      </form>
    </div>`;
}

function bindTema() {
  const fp = document.getElementById("f-propuesta");
  if (fp) {
    const inp = document.getElementById("propuesta");
    inp.oninput = () => { S.propuestaTxt = inp.value; };
    inp.focus();
    document.getElementById("b-sortear").onclick = () => { S.propuestaTxt = temaAlAzar(inp.value); inp.value = S.propuestaTxt; };
    fp.onsubmit = (ev) => {
      ev.preventDefault();
      const t = inp.value.trim();
      if (!t) return;
      S.propuestaTxt = "";
      set(salaRef(`cats/${S.sala.catIndex}/propuesta/${S.uid}`), { tema: t }).catch((e) => alert(e.message));
    };
  }
  const bs = document.getElementById("b-saltar");
  if (bs) bs.onclick = () => {
    const orden = jugadoresOrden(S.sala);
    update(salaRef(), { [`cats/${S.sala.catIndex}/proponente`]: orden[(S.sala.turno || 0) % orden.length], turno: (S.sala.turno || 0) + 1 });
  };
  if (!document.getElementById("b-usar")) return;
  const usar = (tema) => { S.sugerencia = null; iniciarEscritura(tema, null); };
  document.getElementById("b-otro").onclick = () => { S.sugerencia = temaAlAzar(S.sugerencia); render(true); };
  document.getElementById("b-usar").onclick = () => usar(S.sugerencia);
  document.getElementById("f-propio").onsubmit = (ev) => {
    ev.preventDefault();
    const t = document.getElementById("propio").value.trim();
    if (t) usar(t);
  };
}

// --- Escribir
const estoyListo = () => !!catActual().listos?.[S.uid];
const tiempoTerminado = () => !!catActual().finEn && catActual().finEn - ahora() <= 0;

function tarjetaTema(cat, chica) {
  return `<div class="tema" ${chica ? 'style="font-size:1.3rem;padding:16px"' : ""}>${cat.por ? `<small>Propuesta por ${nombreDe(cat.por)}</small>` : ""}${esc(cat.tema)}</div>`;
}

function pantallaEscribir() {
  const cat = catActual();
  if (!S.borrador) {
    S.borrador = Array(6).fill("");
    const i = S.sala.catIndex;
    get(respRef(i, S.uid)).then((snap) => {
      const p = snap.val()?.palabras;
      if (p && S.sala?.catIndex === i && S.sala.estado === "escribiendo" && S.borrador.every((x) => !x)) {
        S.borrador = Array.from({ length: 6 }, (_, k) => p[k] || "");
        render(true);
      }
    }).catch(() => {});
  }
  return `${barraSala()}
    ${cat.finEn ? `<div class="reloj" id="reloj">⏱</div>` : ""}
    ${tarjetaTema(cat)}
    <div class="card">
      <div class="lista">
        ${S.borrador.map((p, i) => `
          <div class="item"><span class="num">${i + 1}</span>
          <div class="crece"><input type="text" class="palabra" data-i="${i}" maxlength="40" value="${esc(p)}" autocomplete="off">
          <div class="aviso" data-aviso="${i}"></div></div></div>`).join("")}
      </div>
      <div style="margin-top:18px"><button class="btn coral full" id="b-listo"></button></div>
    </div>
    <div class="card"><h3>¿Quién terminó?</h3><div class="jugadores" id="estado-jug"></div>
      ${soyAnfitrion() ? `<button class="btn blanco chico" id="b-cerrar">Cerrar categoría ahora</button>` : ""}
    </div>`;
}

function actualizarEscribir() {
  const s = S.sala;
  if (!s || s.estado !== "escribiendo" || !document.getElementById("b-listo")) return;
  const listos = catActual().listos || {};
  const listo = estoyListo();
  const fin = tiempoTerminado();
  const rep = repetidas(S.borrador || []);
  document.querySelectorAll(".palabra").forEach((inp) => {
    inp.disabled = listo || fin;
    inp.classList.toggle("repetida", rep.has(+inp.dataset.i));
  });
  document.querySelectorAll("[data-aviso]").forEach((a) => { a.textContent = rep.has(+a.dataset.aviso) ? "Ya la pusiste" : ""; });
  const bl = document.getElementById("b-listo");
  bl.disabled = fin || (!listo && rep.size > 0);
  bl.textContent = fin ? "⏱ ¡Se terminó el tiempo!" : listo ? "✏️ Editar mis palabras" : rep.size ? "Corregí las repetidas" : "¡Listo!";
  bl.className = listo || fin ? "btn blanco full" : "btn coral full";
  document.getElementById("estado-jug").innerHTML = jugadoresOrden(s)
    .map((u) => `<span class="ficha ${listos[u] ? "ok" : ""}">${listos[u] ? "✓ " : "… "}${nombreDe(u)}</span>`).join("");
}

function guardarPalabras() {
  clearTimeout(S.guardarTimer);
  if (!S.sala || !S.borrador) return Promise.resolve();
  return set(respRef(S.sala.catIndex, S.uid), { palabras: S.borrador.map((p) => p.trim()) })
    .catch((e) => console.warn("No se pudo guardar", e));
}

function bindEscribir() {
  document.querySelectorAll(".palabra").forEach((inp) => {
    inp.oninput = () => {
      S.borrador[+inp.dataset.i] = inp.value;
      clearTimeout(S.guardarTimer);
      S.guardarTimer = setTimeout(() => guardarPalabras(), 600);
      actualizarEscribir();
    };
    inp.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); document.querySelector(`.palabra[data-i="${+inp.dataset.i + 1}"]`)?.focus(); }
    };
  });
  document.getElementById("b-listo").onclick = async () => {
    const ya = estoyListo();
    if (!ya) await guardarPalabras();
    set(salaRef(`cats/${S.sala.catIndex}/listos/${S.uid}`), ya ? null : true).catch((e) => console.warn(e));
  };
  const bc = document.getElementById("b-cerrar");
  if (bc) bc.onclick = () => {
    if (confirm("¿Cerrar la categoría? Nadie podrá editar sus palabras.")) cerrarCategoria();
  };
  actualizarEscribir();
}

// --- Revisión
function objecionesPendientes(cat) {
  const resol = cat.resoluciones || {};
  return Object.keys(cat.objeciones || {}).filter((k) => !resol[k]);
}

function accionesObjecion(k, uidObjetado, estado, objetores) {
  if (estado) return estado === "vale" ? " ✅" : "";
  if (objetores.length) {
    let h = ` <span class="obj">🚩 ${objetores.map(nombreDe).join(", ")}</span>`;
    if (soyAnfitrion()) h += `<span class="decidir"><button data-resolver="${k}" data-v="vale" title="Vale">✅</button><button data-resolver="${k}" data-v="novale" title="No vale">❌</button><button data-resolver="${k}" data-v="trampa" title="Trampa: −${PENALIDAD_TRAMPA}">🚨</button></span>`;
    return h;
  }
  return uidObjetado !== S.uid ? ` <button class="mini" data-objetar="${k}" title="Objetar">🚩</button>` : "";
}

function chipJugador(m, objeciones) {
  const k = `${m.uid}_${m.i}`;
  const anulado = m.estado === "novale" || m.estado === "trampa";
  const pal = S.resp[S.sala.catIndex]?.[m.uid]?.[m.i] || "";
  return `<span class="chip ${m.uid === S.uid ? "yo" : ""} ${anulado ? "anulado" : ""}">${m.uid === S.uid ? "Vos" : nombreDe(m.uid)}${m.manual ? ` 🙋 <i>${esc(pal)}</i>` : ""}${m.estado === "trampa" ? " 🚨" : ""}${accionesObjecion(k, m.uid, m.estado, Object.keys(objeciones[k] || {}))}</span>`;
}

function pantallaRevision() {
  const s = S.sala;
  const orden = jugadoresOrden(s);
  const turno = Math.min(s.revisionTurno || 0, orden.length - 1);
  const lector = orden[turno];
  if (!S.resp[s.catIndex]) return `${barraSala()}<p class="muted">Cargando palabras…</p>`;
  const cat = datosCat(s.catIndex);
  const calc = calcularCategoria(cat, orden);
  const objeciones = cat.objeciones || {};
  const misVinc = cat.vinculos?.[S.uid] || {};
  const mias = (cat.respuestas?.[S.uid] || []).map((t, i) => ({ t, i })).filter((x) => x.t);
  const esLector = lector === S.uid;

  const items = calc[lector].palabras.map((p, i) => {
    if (!p.texto) return "";
    const conmigo = p.grupo.some((m) => m.uid === S.uid);
    const miLink = Object.entries(misVinc).find(([, v]) => v && v.u === lector && +v.i === i);
    const kLector = `${lector}_${i}`;
    const anulado = p.estado === "novale" || p.estado === "trampa";
    let accion = "";
    if (!esLector) {
      const miEstado = cat.resoluciones?.[`${S.uid}_${miLink?.[0]}`];
      if (conmigo && miLink && !miEstado) accion = `<button class="btn blanco chico" data-quitar="${miLink[0]}">Deshacer "yo también"</button>`;
      else if (!conmigo && mias.length) accion = `<button class="btn chico" data-yo="${i}">🙋 Yo también</button>`;
      if (S.picker === i && !conmigo) {
        accion += `<div class="picker"><span class="muted" style="width:100%">¿Cuál de tus palabras es equivalente?</span>
          ${mias.map((m) => `<button class="btn menta chico" data-elegir="${m.i}" data-para="${i}">${esc(m.t)}</button>`).join("")}
          <button class="btn blanco chico" data-cancelar>Cancelar</button></div>`;
      }
    }
    const objLector = p.grupo.length ? accionesObjecion(kLector, lector, p.estado, Object.keys(objeciones[kLector] || {})) : "";
    return `<div class="palabra-rev ${anulado ? "anulada" : ""}">
      <div class="entre"><span class="texto">${i + 1}. ${esc(p.texto)}${p.estado === "trampa" ? " 🚨" : ""}${objLector}</span><span class="pts ${p.puntos ? "si" : "no"}">${p.puntos}</span></div>
      ${p.grupo.length ? `<div class="chips">${p.grupo.map((m) => chipJugador(m, objeciones)).join("")}</div>` : ""}
      ${accion ? `<div style="margin-top:8px">${accion}</div>` : ""}
    </div>`;
  }).join("");

  const pendientes = objecionesPendientes(cat).length;
  const ultimo = turno >= orden.length - 1;
  return `${barraSala()}
    ${tarjetaTema(cat, true)}
    <div class="entre"><h2>${esLector ? "Leé tus palabras" : `Lee ${nombreDe(lector)}`}</h2><span class="muted">${turno + 1} de ${orden.length}</span></div>
    <p class="muted">Si escribiste lo mismo o un sinónimo (no subcategorías), tocá "Yo también". ¿Algo no cierra? Tocá 🚩 sobre esa persona y lo debaten.</p>
    <div class="lista">${items || '<p class="muted">No escribió palabras.</p>'}</div>
    ${pendientes ? `<div class="error" style="margin-top:16px">🚩 Hay ${pendientes} ${pendientes === 1 ? "objeción" : "objeciones"} sin resolver. ${soyAnfitrion() ? `Decidí con ✅ vale, ❌ no vale o 🚨 trampa (−${PENALIDAD_TRAMPA} puntos).` : `${nombreDe(s.anfitrion)} decide después del debate.`}</div>` : ""}
    ${soyAnfitrion() ? `<div style="margin-top:22px" class="fila">
        ${ultimo ? "" : `<button class="btn blanco" id="b-ver" ${pendientes ? "disabled" : ""}>Saltar a puntajes</button>`}
        <button class="btn coral crece" id="b-sig" ${pendientes ? "disabled" : ""}>${ultimo ? "Ver puntajes de la categoría" : `Siguiente: ${nombreDe(orden[turno + 1])}`}</button>
      </div>` : `<p class="muted" style="margin-top:20px">${nombreDe(s.anfitrion)} pasa al siguiente jugador.</p>`}`;
}

function bindRevision() {
  const s = S.sala;
  const i = s.catIndex;
  const base = `cats/${i}/vinculos/${S.uid}`;
  const orden = jugadoresOrden(s);
  document.querySelectorAll("[data-yo]").forEach((b) => b.onclick = () => { S.picker = +b.dataset.yo; render(true); });
  document.querySelectorAll("[data-cancelar]").forEach((b) => b.onclick = () => { S.picker = null; render(true); });
  document.querySelectorAll("[data-elegir]").forEach((b) => b.onclick = () => {
    const lector = orden[Math.min(s.revisionTurno || 0, orden.length - 1)];
    S.picker = null;
    set(salaRef(`${base}/${b.dataset.elegir}`), { u: lector, i: +b.dataset.para }).catch((e) => alert(e.message));
  });
  document.querySelectorAll("[data-quitar]").forEach((b) => b.onclick = () => remove(salaRef(`${base}/${b.dataset.quitar}`)));
  document.querySelectorAll("[data-objetar]").forEach((b) => b.onclick = () =>
    set(salaRef(`cats/${i}/objeciones/${b.dataset.objetar}/${S.uid}`), true).catch((e) => alert(e.message)));
  document.querySelectorAll("[data-resolver]").forEach((b) => b.onclick = () =>
    set(salaRef(`cats/${i}/resoluciones/${b.dataset.resolver}`), b.dataset.v));
  const sig = document.getElementById("b-sig");
  if (sig) sig.onclick = () => {
    if ((s.revisionTurno || 0) >= orden.length - 1) update(salaRef(), { estado: "tabla" });
    else update(salaRef(), { revisionTurno: (s.revisionTurno || 0) + 1 });
  };
  const ver = document.getElementById("b-ver");
  if (ver) ver.onclick = () => update(salaRef(), { estado: "tabla" });
}

// --- Tabla de la categoría
function tablaRanking(orden, tot, conRondas) {
  const ord = [...orden].sort((a, b) => tot[b].total - tot[a].total);
  return `<table class="ranking"><thead><tr><th>#</th><th>Jugador</th>
    ${conRondas ? Array.from({ length: RONDAS }, (_, r) => `<th class="n">R${r + 1}</th>`).join("") : ""}<th class="n">Total</th></tr></thead>
    <tbody>${ord.map((u, i) => `<tr class="${u === S.uid ? "yo" : ""}"><td>${i + 1}</td><td>${nombreDe(u)}</td>
      ${conRondas ? tot[u].rondas.map((r) => `<td class="n">${r}</td>`).join("") : ""}<td class="n"><b>${tot[u].total}</b></td></tr>`).join("")}</tbody></table>`;
}

function pantallaTabla() {
  const s = S.sala;
  if (!S.resp[s.catIndex]) return `${barraSala({ marcador: false })}<p class="muted">Cargando…</p>`;
  const { orden, porCat, tot } = puntajes(s);
  const calc = porCat[s.catIndex];
  const finRonda = s.catIndex % CATS_POR_RONDA === CATS_POR_RONDA - 1;
  const ultima = s.catIndex >= TOTAL_CATS - 1;
  const ronda = Math.floor(s.catIndex / CATS_POR_RONDA);
  const hojas = orden.map((u) => `
    <div class="hoja ${u === S.uid ? "yo" : ""}">
      <header><span>${nombreDe(u)}</span></header>
      <ol>${calc[u].palabras.map((p) => `<li class="${p.estado === "novale" || p.estado === "trampa" ? "anulada" : ""}"><span>${esc(p.texto) || '<span class="muted">—</span>'}${p.estado === "trampa" ? " 🚨" : p.estado === "novale" ? " ❌" : ""}</span><b class="${p.puntos ? "" : "p0"}">${p.puntos}</b></li>`).join("")}
        ${calc[u].trampas ? `<li class="penal"><span>🚨 Trampa</span><b>−${calc[u].trampas * PENALIDAD_TRAMPA}</b></li>` : ""}</ol>
      <footer><span>Total categoría</span><span>${calc[u].total}</span></footer>
    </div>`).join("");

  let subtotal = "";
  if (finRonda) {
    const totRonda = {};
    orden.forEach((u) => totRonda[u] = { total: tot[u].rondas[ronda] });
    subtotal = `<div class="card"><h2>🏁 Fin de la ronda ${ronda + 1}</h2><p class="muted">Puntos de esta ronda</p>${tablaRanking(orden, totRonda, false)}</div>`;
  }

  let boton = "";
  if (soyAnfitrion()) {
    const txt = ultima ? "Ver resultado final 🏆" : finRonda ? `Empezar ronda ${ronda + 2}` : "Siguiente categoría";
    boton = `<button class="btn coral full" id="b-avanzar">${txt}</button>`;
  } else boton = `<p class="muted">${nombreDe(s.anfitrion)} avanza cuando estén todos.</p>`;

  return `${barraSala({ marcador: false })}
    <h2>${esc(s.cats?.[s.catIndex]?.tema)}</h2>
    <div class="grilla">${hojas}</div>
    ${subtotal}
    <div class="card"><h3>Puntaje acumulado</h3>${tablaRanking(orden, tot, true)}</div>
    ${boton}`;
}

function resultadoFinal() {
  const { orden, porCat, tot } = puntajes({ ...S.sala, estado: "final", catIndex: TOTAL_CATS - 1 });
  const max = Math.max(...orden.map((u) => tot[u].total));
  return { orden, porCat, tot, max, almas: almasGemelas(porCat, orden) };
}

async function guardarHistorial() {
  const s = S.sala;
  const { orden, porCat, tot, max, almas } = resultadoFinal();
  const jugadores = {};
  orden.forEach((u) => jugadores[u] = {
    nombre: s.jugadores[u].nombre, total: tot[u].total, rondas: tot[u].rondas, gano: tot[u].total === max,
    trampas: porCat.reduce((a, c) => a + (c?.[u]?.trampas || 0), 0),
  });
  await push(ref(db, "historial"), {
    fecha: serverTimestamp(), sala: S.codigo, modo: s.modo, anfitrion: s.anfitrion, ajustes: ajustes(),
    temas: Array.from({ length: TOTAL_CATS }, (_, i) => s.cats?.[i]?.tema || ""),
    jugadores, ganadores: orden.filter((u) => tot[u].total === max).map((u) => s.jugadores[u].nombre),
    almasGemelas: almas ? { a: s.jugadores[almas.a].nombre, b: s.jugadores[almas.b].nombre, coincidencias: almas.n } : null,
  });
}

function bindTabla() {
  const b = document.getElementById("b-avanzar");
  if (!b) return;
  b.onclick = async () => {
    const s = S.sala;
    b.disabled = true;
    if (s.catIndex >= TOTAL_CATS - 1) {
      if (!s.guardado) {
        try { await guardarHistorial(); } catch (e) { console.warn("No se guardó el historial", e); }
      }
      update(salaRef(), { estado: "final", guardado: true });
    } else {
      update(salaRef(), cambiosEntrarTema(s.catIndex + 1, s.turno || 0));
    }
  };
}

// --- Final
function pantallaFinal() {
  const s = S.sala;
  if (Array.from({ length: TOTAL_CATS }, (_, i) => S.resp[i]).some((r) => !r)) return `${barraSala({ marcador: false })}<p class="muted">Cargando…</p>`;
  const { orden, tot, max, almas } = resultadoFinal();
  const ganadores = orden.filter((u) => tot[u].total === max);
  let tarjetaAlmas = "";
  if (almas) {
    const semilla = [...(S.codigo + s.partida)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const chiste = CHISTES_ALMAS[semilla % CHISTES_ALMAS.length](nombreDe(almas.a), nombreDe(almas.b), almas.n);
    tarjetaAlmas = `<div class="card almas"><div class="podio">🕵️‍♀️🔍</div><h2>Mención especial: Almas gemelas</h2><p>${chiste}</p><p class="muted">No suma puntos. Solo gloria (y sospechas).</p></div>`;
  }
  return `${barraSala({ marcador: false })}
    <div class="card" style="text-align:center">
      <div class="podio">🏆</div>
      <h2>${ganadores.length > 1 ? "¡Empate!" : "¡Ganó " + nombreDe(ganadores[0]) + "!"}</h2>
      <p class="muted">${ganadores.length > 1 ? ganadores.map(nombreDe).join(" y ") + " con " : "Con "}${max} puntos</p>
    </div>
    <div class="card"><h3>Puntuación final</h3>${tablaRanking(orden, tot, true)}</div>
    ${tarjetaAlmas}
    <div class="fila">
      ${soyAnfitrion() ? `<button class="btn coral crece" id="b-otra">Jugar otra vez</button>` : `<p class="muted crece">Si ${nombreDe(s.anfitrion)} arma otra, te quedás en la sala.</p>`}
      <button class="btn blanco" id="b-salir">Salir</button>
    </div>`;
}

function bindFinal() {
  const o = document.getElementById("b-otra");
  if (o) o.onclick = () => update(salaRef(), {
    estado: "espera", catIndex: 0, catKey: "0", cats: null, guardado: null, revisionTurno: null, turno: 0,
    partida: String(Number(S.sala.partida || 1) + 1),
  });
  document.getElementById("b-salir").onclick = () => salir(true);
}

// ---------- render ----------
const PANTALLAS_SALA = {
  espera: [pantallaEspera, bindEspera],
  tema: [pantallaTema, bindTema],
  escribiendo: [pantallaEscribir, bindEscribir],
  revision: [pantallaRevision, bindRevision],
  tabla: [pantallaTabla, bindTabla],
  final: [pantallaFinal, bindFinal],
};

function render(forzar) {
  if (S.pantalla !== "sala") {
    const [html, bind] = { clave: [pantallaClave, bindClave], inicio: [pantallaInicio, bindInicio], modos: [pantallaModos, bindModos] }[S.pantalla]
      || [() => `<p class="muted">Cargando…</p>`, () => {}];
    $app.innerHTML = html();
    bind();
    return;
  }
  const s = S.sala;
  if (!s) return;
  const clave = `${s.partida}|${s.estado}|${s.catIndex}|${s.estado === "revision" ? s.revisionTurno || 0 : ""}`;
  const mismaPantalla = clave === S.claveRender;
  if (!mismaPantalla) { S.picker = null; S.borrador = null; S.tiempoAgotado = false; }
  // Mientras se escribe no se redibujan los campos, para no perder lo que se está tipeando
  if (s.estado === "escribiendo" && mismaPantalla && !forzar) { actualizarEscribir(); return; }
  // Lo mismo con el modal de propuesta
  if (s.estado === "tema" && mismaPantalla && !forzar && document.getElementById("f-propuesta")) return;
  S.claveRender = clave;
  const [html, bind] = PANTALLAS_SALA[s.estado] || PANTALLAS_SALA.espera;
  const y = window.scrollY;
  $app.innerHTML = html();
  bind();
  window.scrollTo(0, mismaPantalla ? y : 0);
}

iniciar();
