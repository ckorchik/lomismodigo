// Identidad "Lo Mismo Digo": logo, ícono y destellos.
export const COLORES = { crema: "#FBF3E8", tinta: "#17142B", coral: "#FF5B4A", lima: "#D5F04B", lavanda: "#C9B8F5", rosa: "#FF9CCB", cielo: "#8FD3FF" };
const C = COLORES;

// Destello de 4 puntas
export function sparkD(r) {
  const k = r * 0.16;
  return `M0 ${-r} C${k} ${-k} ${k} ${-k} ${r} 0 C${k} ${k} ${k} ${k} 0 ${r} C${-k} ${k} ${-k} ${k} ${-r} 0 C${-k} ${-k} ${-k} ${-k} 0 ${-r}Z`;
}
export const destello = (fill, cls = "") => `<svg class="${cls}" viewBox="-50 -50 100 100" aria-hidden="true"><path d="${sparkD(46)}" fill="${fill}"/></svg>`;

// Logo completo: burbuja vacía "lo mismo" + burbuja llena "digo"
export function logo({ oscuro = false, animado = false, puntos = "+3" } = {}) {
  const linea = oscuro ? C.crema : C.tinta;
  const fondo = oscuro ? C.tinta : C.crema;
  return `<div class="lmd ${animado ? "anim" : ""}" role="img" aria-label="Lo Mismo Digo">
    <span class="bub out" style="color:${linea};--bg:${fondo}">lo mismo</span>
    <span class="bub fill">digo</span>
    ${destello(C.lima, "sp1")}${destello(linea, "sp2")}
    ${puntos ? `<span class="pts">${puntos}</span>` : ""}</div>`;
}

// Ícono (app / lockup)
export function icono(size, bg = C.crema, linea = C.tinta) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" style="display:block;flex:none" aria-hidden="true">
    <rect width="100" height="100" rx="24" fill="${bg}"/>
    <rect x="11" y="18" width="60" height="34" rx="17" fill="${bg}" stroke="${linea}" stroke-width="6" transform="rotate(-6 41 35)"/>
    <g transform="rotate(5 60 62)"><rect x="34" y="44" width="56" height="36" rx="18" fill="${C.coral}"/><path d="M78 76 L80 92 L66 79Z" fill="${C.coral}"/></g>
    <path d="${sparkD(14)}" transform="translate(30 52)" fill="${C.lima}" stroke="${linea}" stroke-width="3"/></svg>`;
}

// Lockup horizontal para barras
export const lockup = () => `<div class="lockup">${icono(34, "#fff")}<span>lo mismo digo</span></div>`;

// Explosión de destellos (al tocar el botón principal)
export function explosion(x, y) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const b = document.createElement("div");
  b.className = "burst";
  b.style.left = x + "px";
  b.style.top = y + "px";
  const cols = [C.lima, C.coral, C.lavanda, C.cielo, C.lima, C.coral];
  b.innerHTML = cols.map((c, i) => {
    const a = -Math.PI / 2 + (i - 2.5) * 0.5, d = 46 + (i % 2) * 14;
    return `<svg style="--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d}px" viewBox="-50 -50 100 100"><path d="${sparkD(46)}" fill="${c}"/></svg>`;
  }).join("");
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 1100);
}
