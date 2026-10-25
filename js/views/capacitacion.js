// Capacitación: material de apoyo (PDF) para el personal.
import { h } from '../ui.js';

export function render(root) {
  const url = './assets/capacitacion.pdf';
  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Capacitación')),
    h('div', { class: 'card' },
      h('h3', null, 'Control de asistencia con credencial QR'),
      h('p', { class: 'muted' }, 'Flujo de los datos, quién interviene en cada paso, organización de la escuela, lo que se ve en la puerta, un día de trabajo y cuidado de los datos personales (8 páginas, con licencias y soporte).'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, 'Abrir PDF'),
        h('a', { class: 'btn', href: url, download: 'Capacitacion_Checador_QR.pdf' }, 'Descargar')))));
}
