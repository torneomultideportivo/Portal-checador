// Vista de impresión común: recibe páginas (nodos .print-page) y muestra la barra para imprimir o guardar como PDF.
import { h, icon } from './ui.js';

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
