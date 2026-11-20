// Lógica de coincidencias y puntaje (sin dependencias).

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

// cat: { respuestas: {uid: {palabras: []}}, vinculos: {uid: {idx: {u, i}}} }
// orden: array de uids
// Devuelve { [uid]: { total, palabras: [{ texto, puntos, con: [uids] }] } }
export function calcularCategoria(cat, orden) {
  const resp = (cat && cat.respuestas) || {};
  const vinc = (cat && cat.vinculos) || {};
  const padre = {};
  const nodos = [];
  const buscar = (x) => (padre[x] === x ? x : (padre[x] = buscar(padre[x])));
  const unir = (a, b) => { if (padre[a] && padre[b]) padre[buscar(a)] = buscar(b); };

  const porClave = {};
  for (const uid of orden) {
    const pals = (resp[uid] && resp[uid].palabras) || [];
    for (let i = 0; i < 6; i++) {
      const k = clave(pals[i]);
      if (!k) continue;
      const id = uid + ":" + i;
      padre[id] = id;
      nodos.push({ id, uid, i });
      (porClave[k] = porClave[k] || []).push(id);
    }
  }
  for (const ids of Object.values(porClave)) for (let j = 1; j < ids.length; j++) unir(ids[0], ids[j]);
  for (const uid of Object.keys(vinc)) {
    for (const [i, v] of Object.entries(vinc[uid] || {})) {
      if (v) unir(uid + ":" + i, v.u + ":" + v.i);
    }
  }

  const grupos = {};
  for (const n of nodos) (grupos[buscar(n.id)] = grupos[buscar(n.id)] || []).push(n);

  const res = {};
  for (const uid of orden) {
    const pals = (resp[uid] && resp[uid].palabras) || [];
    res[uid] = { total: 0, palabras: Array.from({ length: 6 }, (_, i) => ({ texto: pals[i] || "", puntos: 0, con: [] })) };
  }
  for (const g of Object.values(grupos)) {
    const jugadores = [...new Set(g.map((n) => n.uid))];
    const vistos = new Set();
    for (const n of g) {
      const p = res[n.uid].palabras[n.i];
      p.con = jugadores.filter((u) => u !== n.uid);
      // Si alguien repite la misma palabra, solo cuenta una vez.
      if (jugadores.length >= 2 && !vistos.has(n.uid)) {
        p.puntos = jugadores.length;
        res[n.uid].total += p.puntos;
      }
      vistos.add(n.uid);
    }
  }
  return res;
}
