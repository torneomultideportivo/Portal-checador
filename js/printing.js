// Vista de impresión común: recibe páginas (nodos .print-page) y muestra la barra para imprimir o guardar como PDF.
import { h, icon, esc } from './ui.js';
import { state, sid } from './state.js';
import { rpc } from './api.js';

export function openPrintPages(pages, label, tip = '') {
  const root = h('div', { id: 'print-root' },
    h('div', { class: 'print-bar no-print' },
      h('span', null, `${label} · ${pages.length} hoja(s) tamaño carta`),
      h('button', { class: 'btn primary', onclick: () => window.print() }, icon('print', 18), ' Imprimir / Guardar como PDF'),
      h('button', { class: 'btn', onclick: () => { root.remove(); document.body.classList.remove('printing'); } }, 'Cerrar')),
    h('p', { class: 'no-print muted pad' }, tip || 'En la ventana de impresión elige tamaño Carta, escala 100 % y desactiva "Encabezados y pies de página". Para guardar el archivo elige "Guardar como PDF".'),
    ...pages);
  document.body.append(root);
  document.body.classList.add('printing');
  return root;
}

const upE = t => esc(String(t ?? '').toLocaleUpperCase('es-MX'));

// Encabezado oficial de la escuela (logos, instituto, escuela, claves y lugar) con los datos de Configuración.
export async function schoolHeadHtml() {
  const school = state.school;
  const assets = await rpc('school_assets', { p_school: sid() });
  const logo = (src, side) => src ? `<img class="lp-logo ${side}" src="${src}" alt="">` : `<div class="lp-logo ${side}"></div>`;
  const inst = String(assets.header_line || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => `<div>${upE(x)}</div>`).join('');
  const claves = [school.cct, assets.internal_key].filter(Boolean).map(upE).join('&nbsp;&nbsp;&nbsp;&nbsp;');
  return `<div class="lp-head">${logo(assets.logo_ieepo, 'l')}
    <div class="lp-inst">${inst}<div>${upE(school.name)}</div>${claves ? `<div>${claves}</div>` : ''}${assets.place_line ? `<div>${upE(assets.place_line)}</div>` : ''}</div>
    ${logo(assets.logo_school, 'r')}</div>`;
}

// Imprime lo que se ve en pantalla (tablas y totales) con el encabezado de la escuela. Quita botones y filtros.
export async function printScreen(el, title, sub = '') {
  const head = await schoolHeadHtml();
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.btn-row, button, .filters, .no-print').forEach(n => n.remove());
  const page = h('div', { class: 'print-page rp-page', html: `${head}<div class="lp-titulo"><span>${upE(title)}</span><span>${esc(sub)}</span></div><div class="rp-body">${copy.innerHTML}</div>` });
  openPrintPages([page], title);
}
