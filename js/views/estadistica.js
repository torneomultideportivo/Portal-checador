// Estadística de alumnos (solo administrativo): sexo, edad, grado y grupo. Sexo y edad salen de la CURP.
import { h, clear, toast, guard, spinner, downloadXlsx } from '../ui.js';
import { state } from '../state.js';
import { errMsg, curpBirth, norm, fmtDate, todayLocal } from '../logic.js';
import { loadStudentsFull } from './students.js';
import { openPrintPages, schoolHeadHtml } from '../printing.js';

const sexOf = s => { const x = norm(s.curp)[10]; if (x === 'H' || x === 'M') return x; const g = norm(s.genero); return g.startsWith('H') ? 'H' : g.startsWith('M') ? 'M' : ''; };
function ageOf(curp, hoy) {
  const b = curpBirth(curp); if (!b) return null;
  const [y, m, d] = hoy.split('-').map(Number);
  return y - b.y - ((m < b.m || (m === b.m && d < b.d)) ? 1 : 0);
}
const pct = (n, t) => (t ? (n / t * 100).toFixed(1) + ' %' : '0 %');

export function compute(rows, hoy) {
  const r = { total: rows.length, M: 0, H: 0, lengua: 0, sinDato: 0, edades: new Map(), grupos: new Map(), edadGrado: new Map() };
  for (const s of rows) {
    const sx = sexOf(s), age = ageOf(s.curp, hoy);
    if (sx === 'M') r.M++; else if (sx === 'H') r.H++;
    if (s.lengua_indigena) r.lengua++;
    if (age === null || !sx) r.sinDato++;
    if (age !== null) {
      const e = r.edades.get(age) || { M: 0, H: 0 }; if (sx) e[sx]++; r.edades.set(age, e);
      const k = `${age}|${s.grado}`; r.edadGrado.set(k, (r.edadGrado.get(k) || 0) + 1);
    }
    const gk = `${s.grado}|${s.grupo}`; const g = r.grupos.get(gk) || { grado: s.grado, grupo: s.grupo, M: 0, H: 0 }; if (sx) g[sx]++; r.grupos.set(gk, g);
  }
  return r;
}

export function render(root) {
  const school = state.school;
  const hoy = todayLocal(school.timezone);
  let all = [];
  const out = h('div');
  const sel = (label, opts) => { const s = h('select', { class: 'input' }, h('option', { value: '' }, 'Todos'), ...opts.map(o => h('option', { value: o[0] }, o[1]))); s.addEventListener('change', draw); return { s, el: h('label', { class: 'field' }, h('span', null, label), s) }; };
  const fG = sel('Grado', school.grades.map(g => [g, `${g}°`])), fP = sel('Grupo', school.groups.map(g => [g, g])),
    fS = sel('Sexo', [['M', 'Niñas'], ['H', 'Niños']]), fL = sel('Lengua indígena', [['si', 'Sí hablan'], ['no', 'No hablan']]);
  const filtered = () => all.filter(s => s.active && (!fG.s.value || s.grado === fG.s.value) && (!fP.s.value || s.grupo === fP.s.value)
    && (!fS.s.value || sexOf(s) === fS.s.value) && (!fL.s.value || (fL.s.value === 'si') === !!s.lengua_indigena));

  const tbl = (head, body, cls = '') => h('table', { class: 'tbl ' + cls }, h('thead', null, h('tr', null, head.map(t => h('th', null, t)))), h('tbody', null, body));
  const gradeRows = r => {
    const list = [...r.grupos.values()].sort((a, b) => a.grado.localeCompare(b.grado, 'es', { numeric: true }) || a.grupo.localeCompare(b.grupo, 'es'));
    const rows = []; let cur = null, tm = 0, th = 0;
    const flush = () => { if (cur !== null) rows.push(h('tr', { class: 'st-sub' }, h('td', null, `Total ${cur}°`), h('td', null, tm), h('td', null, th), h('td', null, tm + th))); };
    for (const g of list) {
      if (g.grado !== cur) { flush(); cur = g.grado; tm = 0; th = 0; }
      tm += g.M; th += g.H;
      rows.push(h('tr', null, h('td', null, `${g.grado}° ${g.grupo}`), h('td', null, g.M), h('td', null, g.H), h('td', null, h('b', null, g.M + g.H))));
    }
    flush();
    rows.push(h('tr', { class: 'st-tot' }, h('td', null, 'Escuela'), h('td', null, r.M), h('td', null, r.H), h('td', null, r.M + r.H)));
    return rows;
  };
  const ages = r => [...r.edades.keys()].sort((a, b) => a - b);
  const chart = r => {
    const as = ages(r); const mx = Math.max(1, ...as.map(a => r.edades.get(a).M + r.edades.get(a).H));
    return h('div', null,
      h('div', { class: 'st-chart' }, as.map(a => { const e = r.edades.get(a), t = e.M + e.H;
        return h('div', { class: 'st-col' }, h('div', { class: 'st-num' }, t),
          h('div', { class: 'st-stack', style: { height: `${Math.max(4, t / mx * 170)}px` } }, h('div', { class: 'st-m', style: { height: `${t ? e.M / t * 100 : 0}%` } }), h('div', { class: 'st-h', style: { height: `${t ? e.H / t * 100 : 0}%` } })),
          h('div', { class: 'st-lb' }, `${a} años`), h('div', { class: 'st-mh' }, h('span', { class: 'st-mc' }, `♀ ${e.M}`), ' ', h('span', { class: 'st-hc' }, `♂ ${e.H}`))); })),
      h('div', { class: 'st-leg' }, h('i', { class: 'st-m' }), 'Niñas', h('i', { class: 'st-h' }), 'Niños'));
  };
  const ageGradeRows = r => ages(r).map(a => { const c = school.grades.map(g => r.edadGrado.get(`${a}|${g}`) || 0);
    return h('tr', null, h('td', null, `${a} años`), c.map(x => h('td', null, x || '·')), h('td', null, h('b', null, c.reduce((p, q) => p + q, 0)))); });

  function excel(r) {
    const gr = [...r.grupos.values()].sort((a, b) => a.grado.localeCompare(b.grado, 'es', { numeric: true }) || a.grupo.localeCompare(b.grupo, 'es'));
    return downloadXlsx(`estadistica_alumnos_${hoy}.xlsx`, [
      { name: 'Resumen', columns: [{ header: 'Concepto', key: 'c', width: 34 }, { header: 'Alumnos', key: 'n' }, { header: 'Porcentaje', key: 'p' }],
        rows: [{ c: 'Total de alumnos', n: r.total, p: '100 %' }, { c: 'Niñas', n: r.M, p: pct(r.M, r.total) }, { c: 'Niños', n: r.H, p: pct(r.H, r.total) }, { c: 'Hablan lengua indígena', n: r.lengua, p: pct(r.lengua, r.total) }] },
      { name: 'Por edad', columns: [{ header: 'Edad', key: 'e' }, { header: 'Niñas', key: 'm' }, { header: 'Niños', key: 'h' }, { header: 'Total', key: 't' }],
        rows: ages(r).map(a => { const e = r.edades.get(a); return { e: `${a} años`, m: e.M, h: e.H, t: e.M + e.H }; }) },
      { name: 'Por grupo', columns: [{ header: 'Grado', key: 'g' }, { header: 'Grupo', key: 'p' }, { header: 'Niñas', key: 'm' }, { header: 'Niños', key: 'h' }, { header: 'Total', key: 't' }],
        rows: [...gr.map(g => ({ g: g.grado, p: g.grupo, m: g.M, h: g.H, t: g.M + g.H })), { g: 'TOTAL', p: '', m: r.M, h: r.H, t: r.M + r.H }] },
      { name: 'Edad por grado', columns: [{ header: 'Edad', key: 'e' }, ...school.grades.map(g => ({ header: `${g}°`, key: 'g' + g })), { header: 'Total', key: 't' }],
        rows: ages(r).map(a => { const o = { e: `${a} años` }; let t = 0; for (const g of school.grades) { o['g' + g] = r.edadGrado.get(`${a}|${g}`) || 0; t += o['g' + g]; } o.t = t; return o; }) },
    ], [school.name, 'Estadística de alumnos', `Edades al ${fmtDate(hoy)}`]);
  }
  async function print(r) {
    const head = await schoolHeadHtml();
    const page = h('div', { class: 'print-page stat-page' },
      h('div', { html: head }), h('p', null, `Estadística de alumnos · edades al ${fmtDate(hoy)}`),
      h('p', null, `Total ${r.total} · Niñas ${r.M} (${pct(r.M, r.total)}) · Niños ${r.H} (${pct(r.H, r.total)}) · Lengua indígena ${r.lengua}`),
      h('h3', null, 'Por edad'), tbl(['Edad', 'Niñas', 'Niños', 'Total'], ages(r).map(a => { const e = r.edades.get(a); return h('tr', null, h('td', null, `${a} años`), h('td', null, e.M), h('td', null, e.H), h('td', null, e.M + e.H)); })),
      h('h3', null, 'Por grado y grupo'), tbl(['Grupo', 'Niñas', 'Niños', 'Total'], gradeRows(r)));
    openPrintPages([page], 'Estadística de alumnos');
  }

  function draw() {
    const rows = filtered(), r = compute(rows, hoy);
    const k = (cls, n, t) => h('div', { class: 'k ' + cls }, h('b', null, n), h('span', null, t));
    clear(out).append(
      h('div', { class: 'st-kpis' }, k('', r.total, 'Alumnos'), k('st-mc', r.M, `Niñas · ${pct(r.M, r.total)}`), k('st-hc', r.H, `Niños · ${pct(r.H, r.total)}`), k('', r.lengua, `Hablan lengua indígena · ${pct(r.lengua, r.total)}`)),
      r.sinDato ? h('div', { class: 'note' }, `${r.sinDato} alumno(s) sin CURP completa o válida: no entran en la gráfica de edad o de sexo.`) : null,
      h('div', { class: 'two-col' },
        h('div', { class: 'card' }, h('h3', null, 'Alumnos por edad'), r.edades.size ? chart(r) : h('div', { class: 'empty' }, 'Sin datos')),
        h('div', { class: 'card' }, h('h3', null, 'Por grado y grupo'), tbl(['Grupo', 'Niñas', 'Niños', 'Total'], gradeRows(r), 'st-tbl'))),
      h('div', { class: 'card' }, h('h3', null, 'Edad por grado'), tbl(['Edad', ...school.grades.map(g => `${g}°`), 'Total'], ageGradeRows(r)),
        h('p', { class: 'muted small' }, 'Sirve para ver quién va adelantado o con rezago respecto a la edad típica de su grado.')),
      h('div', { class: 'btn-row' }, (() => { const b = h('button', { class: 'btn primary' }, 'Descargar Excel'); b.onclick = () => guard(b, () => excel(r)); return b; })(),
        h('button', { class: 'btn', onclick: ev => guard(ev.currentTarget, () => print(r)) }, 'Imprimir')));
  }

  root.append(h('section', { class: 'view' }, h('div', { class: 'view-head' }, h('h2', null, 'Estadística de alumnos')),
    h('p', { class: 'muted' }, `Alumnos activos · edades en años cumplidos al ${fmtDate(hoy)}, calculadas con la CURP.`),
    h('div', { class: 'filters wrap' }, fG.el, fP.el, fS.el, fL.el), out));
  clear(out).append(spinner());
  loadStudentsFull().then(r => { all = r; draw(); }).catch(e => { clear(out).append(h('div', { class: 'note bad' }, errMsg(e))); toast(errMsg(e), 'bad'); });
}
