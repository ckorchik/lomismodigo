import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { auth, db, configurado } from "./firebase.js";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fecha = (t) => (t ? new Date(t).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—");
const encabezado = `<div class="barra"><div class="logo logo-chico"><span>un<span class="acento">á</span>nime</span><span class="burbuja">✓</span></div><a href="./" class="btn blanco chico">Ir al juego</a></div><h2>Panel de admin</h2>`;

function pantallaLogin(msg = "") {
  $app.innerHTML = `${encabezado}<div class="card"><p>Ingresá con la cuenta de Google de admin.</p>
    ${msg ? `<div class="error">${esc(msg)}</div>` : ""}
    <button class="btn coral" id="b-login">Entrar con Google</button></div>`;
  document.getElementById("b-login").onclick = () =>
    signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => pantallaLogin(e.message));
}

async function cargar(user) {
  $app.innerHTML = `${encabezado}<p class="muted">Cargando datos…</p>`;
  let historial, miembros;
  try {
    [historial, miembros] = await Promise.all([get(ref(db, "historial")), get(ref(db, "miembros"))]);
  } catch (e) {
    $app.innerHTML = `${encabezado}<div class="card"><div class="error">La cuenta ${esc(user.email)} no tiene acceso de admin.</div>
      <button class="btn blanco" id="b-salir">Cerrar sesión</button></div>`;
    document.getElementById("b-salir").onclick = () => signOut(auth);
    return;
  }
  const partidas = Object.values(historial.val() || {}).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  const jug = miembros.val() || {};
  const conteo = {};
  for (const p of partidas) for (const [uid, j] of Object.entries(p.jugadores || {})) {
    conteo[uid] = conteo[uid] || { partidas: 0, victorias: 0, puntos: 0 };
    conteo[uid].partidas++; conteo[uid].puntos += j.total || 0; if (j.gano) conteo[uid].victorias++;
  }
  const ahora = new Date();
  const esteMes = partidas.filter((p) => { const d = new Date(p.fecha); return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear(); }).length;
  const filasJug = Object.entries(jug)
    .sort((a, b) => (conteo[b[0]]?.partidas || 0) - (conteo[a[0]]?.partidas || 0))
    .map(([uid, m]) => `<tr><td>${esc(m.nombre)}<br><span class="id">${esc(uid)}</span></td>
      <td>${fecha(m.alta)}</td><td>${fecha(m.ultimaVez)}</td>
      <td class="n">${conteo[uid]?.partidas || 0}</td><td class="n">${conteo[uid]?.victorias || 0}</td></tr>`).join("");
  const filasPart = partidas.map((p) => {
    const js = Object.values(p.jugadores || {}).sort((a, b) => b.total - a.total);
    return `<tr><td>${fecha(p.fecha)}<br><span class="id">Sala ${esc(p.sala)}</span></td>
      <td>${js.map((j) => `${j.gano ? "🏆 " : ""}${esc(j.nombre)} <b>${j.total}</b>`).join("<br>")}</td>
      <td class="muted">${(p.temas || []).map(esc).join("<br>")}</td>
      <td>${p.almasGemelas ? `🕵️ ${esc(p.almasGemelas.a)} y ${esc(p.almasGemelas.b)} (${p.almasGemelas.coincidencias})` : "—"}
      ${js.some((j) => j.trampas) ? `<br>🚨 ${js.filter((j) => j.trampas).map((j) => `${esc(j.nombre)} (${j.trampas})`).join(", ")}` : ""}</td></tr>`;
  }).join("");

  $app.innerHTML = `${encabezado}
    <p class="muted">Sesión: ${esc(user.email)} · <a href="#" id="b-salir">cerrar sesión</a></p>
    <div class="stats">
      <div class="stat"><b>${partidas.length}</b>partidas jugadas</div>
      <div class="stat"><b>${esteMes}</b>partidas este mes</div>
      <div class="stat"><b>${Object.keys(jug).length}</b>jugadores registrados</div>
    </div>
    <div class="card scroll"><h3>Jugadores</h3>
      <table class="ranking"><thead><tr><th>Nombre / ID</th><th>Alta</th><th>Última vez</th><th class="n">Partidas</th><th class="n">Ganadas</th></tr></thead>
      <tbody>${filasJug || '<tr><td colspan="5" class="muted">Todavía no hay jugadores.</td></tr>'}</tbody></table></div>
    <div class="card scroll"><h3>Historial de partidas</h3>
      <table class="ranking"><thead><tr><th>Fecha</th><th>Puntajes</th><th>Temas</th><th>Almas gemelas / trampas</th></tr></thead>
      <tbody>${filasPart || '<tr><td colspan="4" class="muted">Todavía no hay partidas.</td></tr>'}</tbody></table></div>`;
  document.getElementById("b-salir").onclick = (e) => { e.preventDefault(); signOut(auth); };
}

if (!configurado) {
  $app.innerHTML = `${encabezado}<div class="card">Falta configurar Firebase en <code>js/firebase-config.js</code>.</div>`;
} else {
  onAuthStateChanged(auth, (user) => (user && !user.isAnonymous ? cargar(user) : pantallaLogin()));
}
