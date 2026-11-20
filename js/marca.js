// Identidad de Lo Mismo Digo: logo, ícono y destellos.
const C = { crema: "#FBF3E8", tinta: "#17142B", coral: "#FF5B4A", lima: "#D5F04B" };

export function sparkD(r) {
  const k = r * 0.16;
  return `M0 ${-r} C${k} ${-k} ${k} ${-k} ${r} 0 C${k} ${k} ${k} ${k} 0 ${r} C${-k} ${k} ${-k} ${k} ${-r} 0 C${-k} ${-k} ${-k} ${-k} 0 ${-r}Z`;
}
export const destello = (fill, cls = "") => `<svg class="${cls}" viewBox="-50 -50 100 100" aria-hidden="true"><path d="${sparkD(46)}" fill="${fill}"/></svg>`;

// Logo completo: burbuja vacía (tu respuesta) + burbuja llena (la coincidencia)
export function logo(animado = false) {
  return `<div class="lmd ${animado ? "anim" : ""}" role="img" aria-label="Lo Mismo Digo">
    <span class="bub out">lo mismo</span>
    <span class="bub fill">digo</span>
    ${destello(C.lima, "sp1")}${destello(C.tinta, "sp2")}
    <span class="pts">+3</span></div>`;
}

export function icono(size, fondo = C.crema, linea = C.tinta) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
  <rect width="100" height="100" rx="24" fill="${fondo}"/>
  <rect x="11" y="18" width="60" height="34" rx="17" fill="${fondo}" stroke="${linea}" stroke-width="6" transform="rotate(-6 41 35)"/>
  <g transform="rotate(5 60 62)"><rect x="34" y="44" width="56" height="36" rx="18" fill="${C.coral}"/><path d="M78 76 L80 92 L66 79Z" fill="${C.coral}"/></g>
  <path d="${sparkD(14)}" transform="translate(30 52)" fill="${C.lima}" stroke="${linea}" stroke-width="3"/></svg>`;
}

// Versión horizontal chica para la barra superior
export const lockup = () => `<div class="lockup">${icono(36)}<span>lo mismo digo</span></div>`;
