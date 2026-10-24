// Aviso de privacidad: consulta, impresión, constancia de entrega a familias y aceptación al entrar.
import { h, clear, toast, modal, guard, icon, esc } from '../ui.js';
import { state, sid, isAdmin } from '../state.js';
import { rpc } from '../api.js';
import { PRIVACY_VERSION, privacySections } from '../privacy_text.js';
import { fmtDate, errMsg } from '../logic.js';
import { loadStudentsFull } from './students.js';

export const privacyBodyEl = school => h('div', { class: 'privacy-doc' },
  h('h3', null, 'AVISO DE PRIVACIDAD INTEGRAL'),
  h('p', { class: 'muted' }, `Sistema de control de asistencia · versión ${PRIVACY_VERSION} (borrador)`),
  ...privacySections(school).flatMap(([t, d]) => [h('h4', null, t), h('p', null, d)]));

// Se muestra al entrar mientras la cuenta no haya aceptado la versión vigente
export function showPrivacyGate({ onAccepted }) {
  const chk = h('input', { type: 'checkbox' });
  const btn = h('button', { class: 'btn primary', disabled: true }, 'Continuar');
  chk.addEventListener('change', () => { btn.disabled = !chk.checked; });
  btn.onclick = () => guard(btn, async () => { await rpc('accept_privacy', { p_version: PRIVACY_VERSION }); m.close(); onAccepted && onAccepted(); });
  const m = modal({ title: 'Aviso de privacidad', wide: true, locked: true,
    body: h('div', null, h('div', { class: 'privacy-scroll' }, privacyBodyEl(state.school)),
      h('label', { class: 'chk big' }, chk, ' He leído y acepto el aviso de privacidad')),
    actions: [btn] });
  return m;
}

export function openPrintNotice(school) {
  const root = h('div', { id: 'print-root' },
    h('div', { class: 'print-bar no-print' }, h('span', null, 'Aviso de privacidad · 1 hoja'),
      h('button', { class: 'btn primary', onclick: () => window.print() }, icon('print', 18), ' Imprimir / Guardar como PDF'),
      h('button', { class: 'btn', onclick: () => { root.remove(); document.body.classList.remove('printing'); } }, 'Cerrar')),
    h('div', { class: 'print-page notice' },
      h('h2', null, school.name), h('p', { class: 'center' }, [school.cct && `CCT ${school.cct}`, school.school_year].filter(Boolean).join(' · ')),
      h('h3', { class: 'center' }, 'AVISO DE PRIVACIDAD INTEGRAL'),
      ...privacySections(school).flatMap(([t, d]) => [h('h4', null, t), h('p', null, d)])));
  document.body.append(root); document.body.classList.add('printing');
}

export function render(root) {
  const school = state.school;
  const famBox = h('div');
  let students = [];

  const drawFam = () => {
    clear(famBox);
    const by = new Map();
    for (const s of students.filter(x => x.active)) {
      const k = `${s.grado}° ${s.grupo}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(s);
    }
    famBox.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Grupo', 'Alumnos', 'Con aviso entregado', 'Última fecha', ''].map(t => h('th', null, t)))),
      h('tbody', null, [...by.entries()].map(([k, arr]) => {
        const done = arr.filter(s => s.privacy_notice_at);
        const last = done.map(s => s.privacy_notice_at).sort().pop();
        const btn = h('button', { class: 'btn small' }, 'Marcar entregado hoy');
        btn.onclick = () => guard(btn, async () => { await rpc('mark_privacy_notice', { p_school: sid(), p_ids: arr.map(s => s.id), p_date: null }); toast(`Se anotó la entrega a ${arr.length} familia(s) de ${k}`, 'ok'); load(); });
        return h('tr', null, h('td', null, h('b', null, k)), h('td', null, arr.length), h('td', null, `${done.length} de ${arr.length}`), h('td', null, last ? fmtDate(last) : '—'), h('td', null, btn));
      }))));
  };
  async function load() {
    try { students = await loadStudentsFull(); drawFam(); } catch (e) { clear(famBox).append(h('div', { class: 'note bad' }, errMsg(e))); }
  }

  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Aviso de privacidad'), h('button', { class: 'btn primary', onclick: () => openPrintNotice(school) }, icon('print', 18), ' Imprimir / PDF')),
    h('div', { class: 'note warn' }, 'Borrador. Antes de usarlo debe revisarlo el área jurídica o de transparencia del IEEPO o de la supervisión: no sustituye una asesoría legal y la ley aplicable a escuelas públicas puede pedir texto específico.'),
    h('div', { class: 'two-col' },
      h('div', { class: 'card' }, privacyBodyEl(school)),
      h('div', null,
        h('div', { class: 'card' }, h('h3', null, 'Dónde aparece'),
          h('ul', { class: 'plain' }, h('li', null, 'Al crear una cuenta: casilla obligatoria.'), h('li', null, 'Al entrar: cada cuenta lo acepta una vez por versión (queda fecha y versión).'),
            h('li', null, 'Pantalla de entrar: enlace permanente.'), h('li', null, 'Impreso: para pegarlo en la escuela y mencionarlo en los citatorios.'))),
        isAdmin() ? h('div', { class: 'card' }, h('h3', null, 'Entrega a las familias'),
          h('p', { class: 'muted' }, 'Como los alumnos son menores, el aviso se da a conocer a sus madres, padres o tutores (junta, citatorio o inscripción). Anota aquí cuándo se entregó.'), famBox) : null))));
  if (isAdmin()) { clear(famBox).append(h('div', { class: 'muted' }, 'Cargando…')); load(); }
}
