// Lógica de coincidencias y puntaje (sin dependencias).

export const PENALIDAD_TRAMPA = 3;
const ARTICULOS = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas"]);

function raiz(p) {
  if (p.endsWith("ces") && p.length > 4) p = p.slice(0, -3) + "z";
  else if (p.endsWith("s") && p.length > 3) p = p.slice(0, -1);
  if (p.endsWith("e") && p.length > 3 && "lrndjz".includes(p[p.length - 2])) p = p.slice(0, -1);
  return p;
}

// "Las Monedas" -> "moneda", "lápices" -> "lapiz", "controles" -> "control"
export function clave(texto) {
  const palabras = (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (palabras.length > 1 && ARTICULOS.has(palabras[0])) palabras.shift();
  return palabras.map(raiz).join(" ");
}

// Índices de palabras repetidas dentro de una misma lista
export function repetidas(lista) {
  const vistas = new Set();
  const rep = new Set();
  lista.forEach((t, i) => {
    const k = clave(t);
    if (!k) return;
    if (vistas.has(k)) rep.add(i);
    vistas.add(k);
  });
  return rep;
}

// Agrupa palabras equivalentes (automáticas + "yo también"), sin los nodos excluidos
function agrupar(resp, vinc, orden, excluidos) {
  const padre = {};
  const nodos = [];
  const buscar = (x) => (padre[x] === x ? x : (padre[x] = buscar(padre[x])));
  const unir = (a, b) => { if (padre[a] && padre[b]) padre[buscar(a)] = buscar(b); };
  const porClave = {};
  for (const uid of orden) {
    const pals = resp[uid] || [];
    for (let i = 0; i < 6; i++) {
      const k = clave(pals[i]);
      const id = uid + "_" + i;
      if (!k || excluidos.has(id)) continue;
      padre[id] = id;
      nodos.push({ id, uid, i });
      (porClave[k] = porClave[k] || []).push(id);
    }
  }
  for (const ids of Object.values(porClave)) for (let j = 1; j < ids.length; j++) unir(ids[0], ids[j]);
  for (const uid of Object.keys(vinc)) {
    for (const [i, v] of Object.entries(vinc[uid] || {})) if (v) unir(uid + "_" + i, v.u + "_" + v.i);
  }
  const grupos = {};
  for (const n of nodos) (grupos[buscar(n.id)] = grupos[buscar(n.id)] || []).push(n);
  return Object.values(grupos);
}

// cat: { respuestas: {uid: [6 palabras]}, vinculos: {uid: {idx: {u, i}}}, resoluciones: {"uid_idx": "vale"|"novale"|"trampa"} }
// Devuelve { [uid]: { total, trampas, palabras: [{ texto, puntos, estado, grupo: [{uid, i, manual, estado}] }] } }
export function calcularCategoria(cat, orden) {
  const resp = (cat && cat.respuestas) || {};
  const vinc = (cat && cat.vinculos) || {};
  const resol = (cat && cat.resoluciones) || {};
  const excluidos = new Set(Object.keys(resol).filter((k) => resol[k] === "novale" || resol[k] === "trampa"));

  const res = {};
  for (const uid of orden) {
    const pals = resp[uid] || [];
    res[uid] = {
      total: 0, trampas: 0,
      palabras: Array.from({ length: 6 }, (_, i) => ({ texto: pals[i] || "", puntos: 0, estado: resol[uid + "_" + i] || null, grupo: [] })),
    };
  }

  // Grupos originales (para mostrar quién coincidió, incluidos los anulados)
  for (const g of agrupar(resp, vinc, orden, new Set())) {
    for (const n of g) {
      res[n.uid].palabras[n.i].grupo = g
        .filter((m) => m.uid !== n.uid)
        .map((m) => ({ uid: m.uid, i: m.i, manual: !!(vinc[m.uid] && vinc[m.uid][m.i]), estado: resol[m.id] || null }));
    }
  }
  // Puntaje real, sin los anulados
  for (const g of agrupar(resp, vinc, orden, excluidos)) {
    const jugadores = [...new Set(g.map((n) => n.uid))];
    const vistos = new Set();
    for (const n of g) {
      if (jugadores.length >= 2 && !vistos.has(n.uid)) {
        res[n.uid].palabras[n.i].puntos = jugadores.length;
        res[n.uid].total += jugadores.length;
      }
      vistos.add(n.uid);
    }
  }
  for (const [k, v] of Object.entries(resol)) {
    if (v !== "trampa") continue;
    const uid = k.slice(0, k.lastIndexOf("_"));
    if (res[uid]) { res[uid].trampas++; res[uid].total -= PENALIDAD_TRAMPA; }
  }
  return res;
}

// Pareja que más coincidió en toda la partida (solo si se destaca)
export function almasGemelas(calcs, orden) {
  const cuenta = {};
  for (const calc of calcs) {
    if (!calc) continue;
    for (const uid of orden) {
      for (const p of calc[uid].palabras) {
        if (!p.puntos) continue;
        for (const m of p.grupo) {
          if (m.estado === "novale" || m.estado === "trampa" || uid >= m.uid) continue;
          const k = uid + "|" + m.uid;
          cuenta[k] = (cuenta[k] || 0) + 1;
        }
      }
    }
  }
  const pares = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
  if (!pares.length || pares[0][1] < 3) return null;
  if (pares[1] && pares[1][1] === pares[0][1]) return null;
  const [a, b] = pares[0][0].split("|");
  return { a, b, n: pares[0][1] };
}
