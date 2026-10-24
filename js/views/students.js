// Alumnos: lista con tutores, alta individual, edición, baja y reposición del QR.
import { h, clear, toast, modal, confirmBox, guard, spinner } from '../ui.js';
import { state, sid } from '../state.js';
import { sb, rpc, fetchAll } from '../api.js';
import { cmpStudent, searchKey, errMsg, norm, CURP_RE, normParentesco, PARENTESCOS, fmtDate } from '../logic.js';
import { refreshRoster } from '../sync.js';

// Lista completa para el administrativo: CURP, lengua indígena y tutores (viene por función; los prefectos no la reciben)
export async function loadStudentsFull() {
  const rows = await rpc('list_students_full', { p_school: sid() });
  return rows.map(r => ({ ...r, curp: r.curp || '' })).sort(cmpStudent);
}
// Versión corta (con el QR) para los módulos que solo necesitan nombre, grupo y CURP
export async function loadStudents(includeInactive = true) {
  const rows = await fetchAll(() => {
    let q = sb.from('students').select('id,nombre,grado,grupo,genero,active,qr_token,student_private(curp)').eq('school_id', sid()).order('id');
    if (!includeInactive) q = q.eq('active', true);
    return q;
  });
  return rows.map(r => ({ ...r, curp: r.student_private?.curp || '' })).sort(cmpStudent);
}

const tutorLabel = t => `${PARENTESCOS[t.parentesco] || 'Tutor(a)'}: ${t.nombre}`;

export function render(root) {
  const school = state.school;
  let rows = [], shown = 80, showInactive = false;
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar alumno, CURP o tutor…' });
  const gSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grados'), ...school.grades.map(g => h('option', { value: g }, `${g}°`)));
  const pSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos los grupos'), ...school.groups.map(g => h('option', { value: g }, g)));
  const chk = h('input', { type: 'checkbox', onchange: e => { showInactive = e.target.checked; draw(); } });
  const info = h('div', { class: 'muted' });
  const list = h('div', { class: 'table-wrap' });

  const draw = () => {
    const words = searchKey(q.value).split(' ').filter(Boolean);
    const f = rows.filter(s => (showInactive || s.active) && (!gSel.value || s.grado === gSel.value) && (!pSel.value || s.grupo === pSel.value) &&
      words.every(w => searchKey(s.nombre + ' ' + s.curp + ' ' + s.tutores.map(t => t.nombre).join(' ')).includes(w)));
    info.textContent = `${f.length} alumno(s)` + (rows.some(s => !s.active) ? ` · ${rows.filter(s => !s.active).length} de baja` : '') + ` · ${rows.filter(s => s.active && !s.tutores.length).length} sin tutor registrado`;
    clear(list);
    if (!f.length) { list.append(h('div', { class: 'empty' }, rows.length ? 'Sin resultados' : 'Aún no hay alumnos. Usa "Importar Excel" para cargarlos (con sus tutores) o agrega uno con "+ Alumno".')); return; }
    list.append(h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ['Alumno', 'Grupo', 'CURP', 'Lengua indígena', 'Tutores', ''].map(t => h('th', null, t)))),
      h('tbody', null, f.slice(0, shown).map(s => h('tr', { class: s.active ? '' : 'inactive', onclick: () => edit(s) },
        h('td', null, s.nombre, s.active ? null : h('span', { class: 'badge muted' }, 'baja')),
        h('td', null, `${s.grado}° ${s.grupo}`),
        h('td', { class: 'mono' }, s.curp),
        h('td', null, s.lengua_indigena || ''),
        h('td', null, s.tutores.length ? s.tutores.map(t => h('div', { class: 'small' }, tutorLabel(t))) : h('span', { class: 'muted' }, 'sin tutor')),
        h('td', null, '›'))))));
    if (f.length > shown) list.append(h('button', { class: 'btn block', onclick: () => { shown += 100; draw(); } }, `Mostrar más (${f.length - shown})`));
  };

  async function reload() {
    clear(list).append(spinner());
    try { rows = await loadStudentsFull(); draw(); } catch (e) { clear(list).append(h('div', { class: 'empty' }, errMsg(e))); }
  }

  function edit(s) {
    const isNew = !s;
    const v = s || { apellido_paterno: '', apellido_materno: '', nombres: '', grado: school.grades[0], grupo: school.groups[0], curp: '', lengua_indigena: '', active: true, tutores: [] };
    const inp = (val, extra = {}) => h('input', { class: 'input', value: val || '', style: { textTransform: 'uppercase' }, ...extra });
    const ap = inp(v.apellido_paterno, { placeholder: 'Apellido paterno' }), am = inp(v.apellido_materno, { placeholder: 'Apellido materno' }), nom = inp(v.nombres, { placeholder: 'Nombre(s)' });
    const grado = h('select', { class: 'input' }, school.grades.map(g => h('option', { value: g, selected: g === v.grado }, `${g}°`)));
    const grupo = h('select', { class: 'input' }, school.groups.map(g => h('option', { value: g, selected: g === v.grupo }, g)));
    const curp = inp(v.curp, { class: 'input mono', maxLength: 18, placeholder: '18 caracteres' });
    const lengua = inp(v.lengua_indigena, { placeholder: 'Ej. MIXTECO (vacío si no habla)' });
    const tut = [0, 1].map(i => {
      const t = v.tutores[i] || {};
      return {
        curp: inp(t.curp, { class: 'input mono', maxLength: 18, placeholder: 'CURP del tutor' }),
        ap: inp(t.apellido_paterno, { placeholder: 'Apellido paterno' }), am: inp(t.apellido_materno, { placeholder: 'Apellido materno' }), nom: inp(t.nombres, { placeholder: 'Nombre(s)' }),
        par: h('select', { class: 'input' }, [['MDR', 'Madre'], ['PDR', 'Padre'], ['TUL', 'Tutor(a)']].map(([k, tx]) => h('option', { value: k, selected: k === (t.parentesco || (i === 0 ? 'MDR' : 'PDR')) }, tx))),
      };
    });
    const save = h('button', { class: 'btn primary' }, 'Guardar');
    const tutBlock = (t, i) => h('fieldset', { class: 'fs' }, h('legend', null, `Tutor ${i + 1}`),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Parentesco'), t.par), h('label', { class: 'field' }, h('span', null, 'CURP'), t.curp)),
      h('div', { class: 'grid3' }, t.ap, t.am, t.nom));
    const m = modal({
      title: isNew ? 'Nuevo alumno' : 'Editar alumno', wide: true,
      body: h('div', { class: 'form' },
        h('div', { class: 'grid3' }, h('label', { class: 'field' }, h('span', null, 'Apellido paterno'), ap), h('label', { class: 'field' }, h('span', null, 'Apellido materno'), am), h('label', { class: 'field' }, h('span', null, 'Nombre(s)'), nom)),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'Grado'), grado), h('label', { class: 'field' }, h('span', null, 'Grupo'), grupo)),
        h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', null, 'CURP'), curp, h('small', { class: 'muted' }, 'El género se toma de la CURP.')), h('label', { class: 'field' }, h('span', null, 'Lengua indígena'), lengua)),
        tutBlock(tut[0], 0), tutBlock(tut[1], 1),
        v.privacy_notice_at ? h('p', { class: 'muted small' }, `Aviso de privacidad entregado a la familia el ${fmtDate(v.privacy_notice_at)}.`) : null,
        isNew ? null : h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: async ev => {
            if (!(await confirmBox(`Se generará un QR nuevo para ${s.nombre}. La credencial anterior dejará de funcionar (si alguien la presenta sonará la alarma) y habrá que imprimir otra.`, { ok: 'Generar QR nuevo', danger: true }))) return;
            await guard(ev.currentTarget, async () => { await rpc('regenerate_qr', { p_school: sid(), p_student: s.id }); toast('QR regenerado. Imprime el nuevo en "QR y credenciales".', 'ok', 5000); });
          } }, 'Reposición de QR'),
          h('button', { class: 'btn small ' + (s.active ? 'danger' : ''), onclick: async ev => {
            const ok = await confirmBox(s.active ? `¿Dar de baja a ${s.nombre}? Conserva su historial pero ya no podrá registrar entrada.` : `¿Reactivar a ${s.nombre}?`, { ok: s.active ? 'Dar de baja' : 'Reactivar', danger: s.active });
            if (!ok) return;
            await guard(ev.currentTarget, async () => { await rpc('save_student2', { p_school: sid(), p_id: s.id, p: { apellido_paterno: s.apellido_paterno, apellido_materno: s.apellido_materno, nombres: s.nombres, grado: s.grado, grupo: s.grupo, active: !s.active } }); m.close(); toast('Listo', 'ok'); await reload(); refreshRoster().catch(() => {}); });
          } }, s.active ? 'Dar de baja' : 'Reactivar'))),
      actions: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), save],
    });
    save.onclick = () => guard(save, async () => {
      const c = norm(curp.value);
      if (c && !CURP_RE.test(c)) throw new Error('CURP_INVALIDA');
      const tutores = tut.map(t => ({ curp: norm(t.curp.value), apellido_paterno: norm(t.ap.value), apellido_materno: norm(t.am.value), nombres: norm(t.nom.value), parentesco: normParentesco(t.par.value) || 'TUL' }))
        .filter(t => t.curp || t.apellido_paterno || t.apellido_materno || t.nombres);
      for (const t of tutores) if (t.curp && !CURP_RE.test(t.curp)) throw new Error('TUTOR_CURP_INVALIDA');
      await rpc('save_student2', { p_school: sid(), p_id: s ? s.id : null, p: { apellido_paterno: ap.value, apellido_materno: am.value, nombres: nom.value, grado: grado.value, grupo: grupo.value, curp: c, lengua_indigena: lengua.value, tutores, active: s ? s.active : true } });
      m.close(); toast('Guardado', 'ok'); await reload(); refreshRoster().catch(() => {});
    });
  }

  [q, gSel, pSel].forEach(el => el.addEventListener('input', () => { shown = 80; draw(); }));
  root.append(h('section', { class: 'view' },
    h('div', { class: 'view-head' }, h('h2', null, 'Alumnos'),
      h('a', { class: 'btn', href: '#/import' }, 'Importar Excel'), h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Alumno')),
    h('div', { class: 'filters' }, q, gSel, pSel), h('label', { class: 'chk' }, chk, ' Mostrar bajas'), info, list));
  reload();
}
