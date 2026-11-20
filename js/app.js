import { signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update, remove, push, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { auth, db, configurado } from "./firebase.js";
import { TEMAS } from "./temas.js";
import { calcularCategoria } from "./puntaje.js";

const RONDAS = 2;
const CATS_POR_RONDA = 3;
const TOTAL_CATS = RONDAS * CATS_POR_RONDA;
const MIN_JUGADORES = 2;

const MODOS = [
  { id: "clasico", nombre: "Clásico", desc: "6 palabras por tema. Sumás puntos coincidiendo con los demás.", activo: true },
  { id: "cronometro", nombre: "Cronómetro", desc: "Solo 1 minuto para escribir las 6 palabras." },
  { id: "iniciales", nombre: "Iniciales prohibidas", desc: "No vale usar palabras que empiecen con 5 letras sorteadas." },
  { id: "idioma", nombre: "Idioma", desc: "Se juega en otro idioma que manejen todos." },
  { id: "equipos", nombre: "Equipos", desc: "Dos equipos eligen juntos sus 6 palabras. Ideal para 8 o más." },
];

const $app = document.getElementById("app");
const S = {
  uid: null, nombre: "", pantalla: "cargando", error: "",
  codigo: null, sala: null, desuscribir: null, claveRender: "",
  modo: "clasico", sugerencia: null, picker: null, borrador: null, guardarTimer: null,
};

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const logo = (clase) => `<div class="logo ${clase}"><span>un<span class="acento">á</span>nime</span><span class="burbuja">✓</span></div>`;
const denegado = (e) => String(e && (e.code || e.message)).toLowerCase().includes("permission");
const jugadoresOrden = (sala) => Object.entries(sala.jugadores || {})
  .sort((a, b) => (a[1].orden || 0) - (b[1].orden || 0) || a[0].localeCompare(b[0]))
  .map(([uid]) => uid);
const nombreDe = (uid) => esc(S.sala?.jugadores?.[uid]?.nombre || "?");
const soyAnfitrion = () => S.sala && S.sala.anfitrion === S.uid;
const salaRef = (p = "") => ref(db, `salas/${S.codigo}${p ? "/" + p : ""}`);

function generarCodigo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => letras[Math.floor(Math.random() * letras.length)]).join("");
}

function setUrlSala(codigo) {
  const url = new URL(location.href);
  if (codigo) url.searchParams.set("sala", codigo); else url.searchParams.delete("sala");
  history.replaceState(null, "", url);
}

// Puntos por categoría (solo las que ya se cerraron) y acumulados
function puntajes(sala) {
  const orden = jugadoresOrden(sala);
  const porCat = [];
  const cerradaHasta = ["tabla", "final"].includes(sala.estado) ? sala.catIndex : sala.catIndex - 1;
  for (let i = 0; i <= cerradaHasta && i < TOTAL_CATS; i++) {
    porCat[i] = calcularCategoria(sala.cats?.[i], orden);
  }
  const tot = {};
  for (const uid of orden) {
    const rondas = Array(RONDAS).fill(0);
    porCat.forEach((c, i) => { if (c) rondas[Math.floor(i / CATS_POR_RONDA)] += c[uid]?.total || 0; });
    tot[uid] = { rondas, total: rondas.reduce((a, b) => a + b, 0) };
  }
  return { orden, porCat, tot };
}

// ---------- arranque ----------
async function iniciar() {
  if (!configurado) {
    $app.innerHTML = `${logo("logo-grande")}<div class="card"><h2>Falta configurar Firebase</h2><p>Pegá tu <code>firebaseConfig</code> en <code>js/firebase-config.js</code>.</p></div>`;
    return;
  }
  onAuthStateChanged(auth, async (user) => {
    if (!user) { signInAnonymously(auth).catch((e) => mostrarError(e)); return; }
    if (S.uid === user.uid) return;
    S.uid = user.uid;
    await verificarMiembro();
  });
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
    if (codigo) return unirse(codigo.toUpperCase(), true);
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
    <p class="muted">${RONDAS} rondas de ${CATS_POR_RONDA} categorías cada una.</p>
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
      anfitrion: S.uid, modo: S.modo, estado: "espera", catIndex: 0, creada: serverTimestamp(),
      jugadores: { [S.uid]: { nombre: S.nombre, orden: Date.now() } },
    });
    escucharSala(codigo);
  } catch (e) { S.error = e.message; render(); }
}

async function unirse(codigo, silencioso) {
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
    automatismosAnfitrion();
    render();
  }, (e) => mostrarError(e));
}

async function salir(avisar = true) {
  if (S.desuscribir) S.desuscribir();
  S.desuscribir = null;
  if (avisar && S.sala && S.codigo) {
    if (soyAnfitrion() && S.sala.estado === "espera") await remove(salaRef()).catch(() => {});
    else if (S.sala.estado === "espera") await remove(salaRef(`jugadores/${S.uid}`)).catch(() => {});
  }
  S.sala = null; S.codigo = null; S.borrador = null;
  setUrlSala(null);
  irA("inicio");
}

// El anfitrión cierra la categoría cuando todos están listos
function automatismosAnfitrion() {
  const s = S.sala;
  if (!soyAnfitrion() || s.estado !== "escribiendo") return;
  const resp = s.cats?.[s.catIndex]?.respuestas || {};
  const todos = jugadoresOrden(s).every((u) => resp[u]?.listo);
  if (todos) update(salaRef(), { estado: "revision", revisionTurno: 0 });
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
    <div class="entre"><span class="progreso">${prog}</span>${s.estado === "espera" ? "" : ""}</div>${fichas}`;
}

// --- Espera
function pantallaEspera() {
  const s = S.sala;
  const orden = jugadoresOrden(s);
  const link = `${location.origin}${location.pathname}?sala=${S.codigo}`;
  return `${barraSala()}
    <div class="card" style="text-align:center">
      <p class="muted">Compartí este código con tu equipo</p>
      <span class="codigo codigo-grande">${esc(S.codigo)}</span>
      <div style="margin-top:14px"><button class="btn blanco chico" id="b-link" data-link="${esc(link)}">Copiar link de invitación</button></div>
    </div>
    <div class="card">
      <h3>Jugadores (${orden.length})</h3>
      <div class="jugadores">${orden.map((u) => `<span class="ficha ${u === S.uid ? "yo" : ""}">${nombreDe(u)}${u === s.anfitrion ? " 👑" : ""}</span>`).join("")}</div>
      <p class="muted">Modo: ${esc(MODOS.find((m) => m.id === s.modo)?.nombre || "Clásico")}</p>
      ${soyAnfitrion()
        ? `<button class="btn coral full" id="b-empezar" ${orden.length < MIN_JUGADORES ? "disabled" : ""}>${orden.length < MIN_JUGADORES ? `Esperando jugadores (mínimo ${MIN_JUGADORES})` : "¡Empezar partida!"}</button>`
        : `<p class="espera muted">Esperando a que ${nombreDe(s.anfitrion)} empiece la partida…</p>`}
    </div>
    <button class="btn blanco chico" id="b-salir">Salir de la sala</button>`;
}

function bindEspera() {
  const bl = document.getElementById("b-link");
  bl.onclick = async () => {
    try { await navigator.clipboard.writeText(bl.dataset.link); bl.textContent = "¡Link copiado!"; }
    catch { prompt("Copiá este link:", bl.dataset.link); }
  };
  document.getElementById("b-salir").onclick = () => salir(true);
  const be = document.getElementById("b-empezar");
  if (be) be.onclick = () => update(salaRef(), { estado: "tema", catIndex: 0, cats: null, guardado: null, revisionTurno: null });
}

// --- Elegir tema (anfitrión)
function sugerirTema() {
  const usados = new Set(Object.values(S.sala.cats || {}).map((c) => c?.tema));
  const libres = TEMAS.filter((t) => !usados.has(t) && t !== S.sugerencia);
  S.sugerencia = libres.length ? libres[Math.floor(Math.random() * libres.length)] : TEMAS[Math.floor(Math.random() * TEMAS.length)];
}

function pantallaTema() {
  if (!soyAnfitrion()) {
    return `${barraSala()}<div class="card espera"><h2>Preparando la categoría…</h2><p class="muted">${nombreDe(S.sala.anfitrion)} está eligiendo el tema.</p></div>`;
  }
  if (!S.sugerencia) sugerirTema();
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
  if (!soyAnfitrion()) return;
  const usar = (tema) => {
    S.sugerencia = null;
    update(salaRef(), { estado: "escribiendo", [`cats/${S.sala.catIndex}/tema`]: tema });
  };
  document.getElementById("b-otro").onclick = () => { sugerirTema(); S.claveRender = ""; render(); };
  document.getElementById("b-usar").onclick = () => usar(S.sugerencia);
  document.getElementById("f-propio").onsubmit = (ev) => {
    ev.preventDefault();
    const t = document.getElementById("propio").value.trim();
    if (t) usar(t);
  };
}

// --- Escribir
function miRespuesta() {
  return S.sala.cats?.[S.sala.catIndex]?.respuestas?.[S.uid] || {};
}

function pantallaEscribir() {
  const s = S.sala;
  const mia = miRespuesta();
  if (!S.borrador) S.borrador = Array.from({ length: 6 }, (_, i) => mia.palabras?.[i] || "");
  return `${barraSala()}
    <div class="tema">${esc(s.cats?.[s.catIndex]?.tema)}</div>
    <div class="card">
      <div class="lista">
        ${S.borrador.map((p, i) => `
          <div class="item"><span class="num">${i + 1}</span>
          <input type="text" class="palabra" data-i="${i}" maxlength="40" value="${esc(p)}" autocomplete="off"></div>`).join("")}
      </div>
      <div style="margin-top:18px"><button class="btn coral full" id="b-listo"></button></div>
    </div>
    <div class="card"><h3>¿Quién terminó?</h3><div class="jugadores" id="estado-jug"></div>
      ${soyAnfitrion() ? `<button class="btn blanco chico" id="b-cerrar">Cerrar categoría ahora</button>` : ""}
    </div>`;
}

function actualizarEscribir() {
  const s = S.sala;
  const resp = s.cats?.[s.catIndex]?.respuestas || {};
  const listo = !!miRespuesta().listo;
  document.querySelectorAll(".palabra").forEach((inp) => { inp.disabled = listo; });
  const bl = document.getElementById("b-listo");
  bl.textContent = listo ? "✏️ Editar mis palabras" : "¡Listo!";
  bl.className = listo ? "btn blanco full" : "btn coral full";
  document.getElementById("estado-jug").innerHTML = jugadoresOrden(s)
    .map((u) => `<span class="ficha ${resp[u]?.listo ? "ok" : ""}">${resp[u]?.listo ? "✓ " : "… "}${nombreDe(u)}</span>`).join("");
}

function guardarPalabras(extra = {}) {
  clearTimeout(S.guardarTimer);
  return update(salaRef(`cats/${S.sala.catIndex}/respuestas/${S.uid}`), { palabras: S.borrador.map((p) => p.trim()), ...extra })
    .catch((e) => console.warn("No se pudo guardar", e));
}

function bindEscribir() {
  document.querySelectorAll(".palabra").forEach((inp) => {
    inp.oninput = () => {
      S.borrador[+inp.dataset.i] = inp.value;
      clearTimeout(S.guardarTimer);
      S.guardarTimer = setTimeout(() => guardarPalabras(), 600);
    };
    inp.onkeydown = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); document.querySelector(`.palabra[data-i="${+inp.dataset.i + 1}"]`)?.focus(); }
    };
  });
  document.getElementById("b-listo").onclick = () => guardarPalabras({ listo: !miRespuesta().listo });
  const bc = document.getElementById("b-cerrar");
  if (bc) bc.onclick = () => {
    if (confirm("¿Cerrar la categoría? Nadie podrá editar sus palabras.")) update(salaRef(), { estado: "revision", revisionTurno: 0 });
  };
  actualizarEscribir();
}

// --- Revisión
function pantallaRevision() {
  const s = S.sala;
  const orden = jugadoresOrden(s);
  const turno = Math.min(s.revisionTurno || 0, orden.length - 1);
  const lector = orden[turno];
  const cat = s.cats?.[s.catIndex] || {};
  const calc = calcularCategoria(cat, orden);
  const misVinc = cat.vinculos?.[S.uid] || {};
  const mias = (cat.respuestas?.[S.uid]?.palabras || []).map((t, i) => ({ t, i })).filter((x) => x.t);
  const esLector = lector === S.uid;

  const items = calc[lector].palabras.map((p, i) => {
    if (!p.texto) return "";
    const conmigo = p.con.includes(S.uid);
    const miLink = Object.entries(misVinc).find(([, v]) => v && v.u === lector && +v.i === i);
    let accion = "";
    if (!esLector) {
      if (conmigo && miLink) accion = `<button class="btn blanco chico" data-quitar="${miLink[0]}">Deshacer "yo también"</button>`;
      else if (!conmigo && mias.length) accion = `<button class="btn chico" data-yo="${i}">🙋 Yo también</button>`;
      if (S.picker === i && !conmigo) {
        accion += `<div class="picker"><span class="muted" style="width:100%">¿Cuál de tus palabras es equivalente?</span>
          ${mias.map((m) => `<button class="btn menta chico" data-elegir="${m.i}" data-para="${i}">${esc(m.t)}</button>`).join("")}
          <button class="btn blanco chico" data-cancelar>Cancelar</button></div>`;
      }
    }
    return `<div class="palabra-rev">
      <div class="entre"><span class="texto">${i + 1}. ${esc(p.texto)}</span><span class="pts ${p.con.length ? "si" : "no"}">${p.con.length ? p.con.length + 1 : 0}</span></div>
      ${p.con.length ? `<div class="chips">${p.con.map((u) => `<span class="chip ${u === S.uid ? "yo" : ""}">${u === S.uid ? "Vos" : nombreDe(u)}</span>`).join("")}</div>` : ""}
      ${accion ? `<div style="margin-top:8px">${accion}</div>` : ""}
    </div>`;
  }).join("");

  const ultimo = turno >= orden.length - 1;
  return `${barraSala()}
    <div class="tema" style="font-size:1.3rem;padding:16px">${esc(cat.tema)}</div>
    <div class="entre"><h2>${esLector ? "Leé tus palabras" : `Lee ${nombreDe(lector)}`}</h2><span class="muted">${turno + 1} de ${orden.length}</span></div>
    <p class="muted">Si escribiste lo mismo o un sinónimo (no subcategorías), tocá "Yo también". Las palabras ya no se pueden editar.</p>
    <div class="lista">${items || '<p class="muted">No escribió palabras.</p>'}</div>
    ${soyAnfitrion() ? `<div style="margin-top:22px" class="fila">
        ${ultimo ? "" : `<button class="btn blanco" id="b-ver">Saltar a puntajes</button>`}
        <button class="btn coral crece" id="b-sig">${ultimo ? "Ver puntajes de la categoría" : `Siguiente: ${nombreDe(orden[turno + 1])}`}</button>
      </div>` : `<p class="muted" style="margin-top:20px">${nombreDe(s.anfitrion)} pasa al siguiente jugador.</p>`}`;
}

function bindRevision() {
  const s = S.sala;
  const base = `cats/${s.catIndex}/vinculos/${S.uid}`;
  document.querySelectorAll("[data-yo]").forEach((b) => b.onclick = () => { S.picker = +b.dataset.yo; render(true); });
  document.querySelectorAll("[data-cancelar]").forEach((b) => b.onclick = () => { S.picker = null; render(true); });
  document.querySelectorAll("[data-elegir]").forEach((b) => b.onclick = () => {
    const lector = jugadoresOrden(s)[Math.min(s.revisionTurno || 0, jugadoresOrden(s).length - 1)];
    S.picker = null;
    set(salaRef(`${base}/${b.dataset.elegir}`), { u: lector, i: +b.dataset.para }).catch((e) => alert(e.message));
  });
  document.querySelectorAll("[data-quitar]").forEach((b) => b.onclick = () => remove(salaRef(`${base}/${b.dataset.quitar}`)));
  const sig = document.getElementById("b-sig");
  if (sig) sig.onclick = () => {
    const n = jugadoresOrden(s).length;
    if ((s.revisionTurno || 0) >= n - 1) update(salaRef(), { estado: "tabla" });
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
  const { orden, porCat, tot } = puntajes(s);
  const calc = porCat[s.catIndex];
  const finRonda = s.catIndex % CATS_POR_RONDA === CATS_POR_RONDA - 1;
  const ultima = s.catIndex >= TOTAL_CATS - 1;
  const ronda = Math.floor(s.catIndex / CATS_POR_RONDA);
  const hojas = orden.map((u) => `
    <div class="hoja ${u === S.uid ? "yo" : ""}">
      <header><span>${nombreDe(u)}</span></header>
      <ol>${calc[u].palabras.map((p) => `<li><span>${esc(p.texto) || '<span class="muted">—</span>'}</span><b class="${p.puntos ? "" : "p0"}">${p.puntos}</b></li>`).join("")}</ol>
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

async function guardarHistorial() {
  const s = S.sala;
  const { orden, tot } = puntajes({ ...s, estado: "final", catIndex: TOTAL_CATS - 1 });
  const max = Math.max(...orden.map((u) => tot[u].total));
  const jugadores = {};
  orden.forEach((u) => jugadores[u] = { nombre: s.jugadores[u].nombre, total: tot[u].total, rondas: tot[u].rondas, gano: tot[u].total === max });
  await push(ref(db, "historial"), {
    fecha: serverTimestamp(), sala: S.codigo, modo: s.modo, anfitrion: s.anfitrion,
    temas: Array.from({ length: TOTAL_CATS }, (_, i) => s.cats?.[i]?.tema || ""),
    jugadores, ganadores: orden.filter((u) => tot[u].total === max).map((u) => s.jugadores[u].nombre),
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
      update(salaRef(), { estado: "tema", catIndex: s.catIndex + 1, revisionTurno: null });
    }
  };
}

// --- Final
function pantallaFinal() {
  const s = S.sala;
  const { orden, tot } = puntajes(s);
  const max = Math.max(...orden.map((u) => tot[u].total));
  const ganadores = orden.filter((u) => tot[u].total === max);
  return `${barraSala({ marcador: false })}
    <div class="card" style="text-align:center">
      <div class="podio">🏆</div>
      <h2>${ganadores.length > 1 ? "¡Empate!" : "¡Ganó " + nombreDe(ganadores[0]) + "!"}</h2>
      <p class="muted">${ganadores.length > 1 ? ganadores.map(nombreDe).join(" y ") + " con " : "Con "}${max} puntos</p>
    </div>
    <div class="card"><h3>Puntuación final</h3>${tablaRanking(orden, tot, true)}</div>
    <div class="fila">
      ${soyAnfitrion() ? `<button class="btn coral crece" id="b-otra">Jugar otra vez</button>` : `<p class="muted crece">Si ${nombreDe(s.anfitrion)} arma otra, te quedás en la sala.</p>`}
      <button class="btn blanco" id="b-salir">Salir</button>
    </div>`;
}

function bindFinal() {
  const o = document.getElementById("b-otra");
  if (o) o.onclick = () => update(salaRef(), { estado: "espera", catIndex: 0, cats: null, guardado: null, revisionTurno: null });
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
  const clave = `${s.estado}|${s.catIndex}|${s.estado === "revision" ? s.revisionTurno || 0 : ""}`;
  if (clave !== S.claveRender) { S.picker = null; if (s.estado !== "escribiendo") S.borrador = null; }
  // En la etapa de escribir no se redibujan los campos para no perder lo que se está tipeando
  if (s.estado === "escribiendo" && clave === S.claveRender && !forzar) { actualizarEscribir(); return; }
  if (s.estado === "escribiendo" && clave !== S.claveRender) S.borrador = null;
  const mismaPantalla = clave === S.claveRender;
  S.claveRender = clave;
  const [html, bind] = PANTALLAS_SALA[s.estado] || PANTALLAS_SALA.espera;
  const y = window.scrollY;
  $app.innerHTML = html();
  bind();
  window.scrollTo(0, mismaPantalla ? y : 0);
}

iniciar();
