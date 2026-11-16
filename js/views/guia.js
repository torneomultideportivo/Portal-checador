// Guía del portal: mapa de pantallas, flujo de la información y capacitación, según el rol de quien entra.
import { h, clear } from '../ui.js';
import { isAdmin } from '../state.js';

// [nombre, descripción, quién la ve: 'a' administrativo, 'p' prefecto]
const MAPA = {
  Registro: [
    ['Escanear', 'Entrada del alumno con la cámara o un lector. Marca puntual o retardo según el horario de la escuela. Sin internet guarda el registro y lo envía al reconectar.', 'ap'],
    ['Manual', 'Respaldo cuando no hay credencial o falla la cámara: buscar por nombre y registrar. Queda anotado como manual.', 'ap'],
    ['Retiro anticipado', 'Salida antes de terminar el horario. Escanea la credencial, elige el motivo (Salud, Cita o asunto familiar, Permiso de dirección, Otro) y anota quién recogió. Solo con internet.', 'ap'],
    ['Hoy', 'Lista del día: quién entró, a qué hora y quién falta.', 'ap'],
    ['Probar QR', 'Comprueba qué alumno corresponde a una credencial sin registrar nada.', 'a'],
  ],
  Seguimiento: [
    ['Retiros del día', 'Cotejo de los retiros contra los documentos en papel. Permite corregir hora o motivo y cancelar con razón.', 'a'],
    ['Retardos y faltas', 'Quiénes acumulan retardos o faltas en un periodo, listo para imprimir con el encabezado de la escuela.', 'a'],
    ['Alarmas de QR', 'Avisa de credenciales repetidas, usadas desde otro teléfono o reemplazadas. Se revisan y se marcan como atendidas.', 'a'],
    ['Reportes y Estadística', 'Asistencia por grupo, por mes y por alumno; se exportan a Excel o se imprimen.', 'a'],
  ],
  Personas: [
    ['Alumnos', 'Alta, baja y datos del alumno. La baja definitiva exige confirmación en tres pasos.', 'a'],
    ['Tutores', 'Madres, padres o tutores y los hijos que tiene cada uno; listas para firma.', 'a'],
    ['Personal', 'Docentes y administrativos que también registran su entrada, si la escuela lo activa.', 'a'],
    ['QR y credenciales', 'Genera e imprime credenciales. Una reposición invalida el QR anterior.', 'a'],
    ['Capacitación', 'Material para aprender a usar el portal.', 'ap'],
  ],
  Comunicación: [
    ['Citatorios', 'Cita a tutores de alumnos con retardos o faltas; se imprime y queda registrado.', 'a'],
    ['Felicitaciones', 'Cumpleaños del día y del mes.', 'a'],
  ],
  Administración: [
    ['Usuarios y roles', 'Claves de acceso, prefectos y administrativos (hasta 4 por escuela).', 'a'],
    ['Configuración', 'Horario de entrada, tolerancia, grados y grupos, encabezado y logos de los reportes.', 'a'],
    ['Concentrado', 'Conexión opcional con el Concentrado de Calificaciones y Asistencias: llave, interruptor y último uso.', 'a'],
    ['Aviso de privacidad', 'Texto vigente que cada cuenta acepta.', 'a'],
    ['Seguridad y Bitácora', 'Quién hizo qué y cuándo.', 'a'],
  ],
};
const ROLES = {
  a: {
    title: 'Administrativo de la escuela',
    text: 'Responsable de que los datos estén completos y de revisar lo que el prefecto registra. Ve todo el menú de su escuela y también puede escanear.',
    can: ['Cargar y mantener alumnos, tutores y credenciales', 'Revisar retardos, faltas, alarmas y retiros del día', 'Corregir o cancelar un registro, siempre con motivo', 'Citar a tutores y entregar los reportes', 'Dar de alta prefectos y activar la conexión con el Concentrado'],
  },
  p: {
    title: 'Prefecto y docente de guardia',
    text: 'Registra en la puerta. Solo ve las pantallas de registro y la capacitación; no ve datos privados ni modifica registros.',
    can: ['Escanear la entrada de cada alumno', 'Registrar manualmente a quien no trae credencial', 'Registrar un retiro anticipado con motivo', 'Consultar Hoy para ver quién ya entró', 'Avisar al administrativo cuando algo no cuadra'],
  },
};
const FLUJO = {
  a: [
    ['Administrativo', '', 'Da de alta alumnos y tutores', 'Importa la lista en Excel o los captura uno a uno. Cada alumno recibe su QR.', 'Alumnos · Tutores'],
    ['Administrativo', '', 'Imprime y entrega credenciales', 'Si una se pierde, genera otra: la anterior queda invalidada y suena la alarma si alguien la usa.', 'QR y credenciales'],
    ['Prefecto', 'p', 'Registra la entrada cada mañana', 'La cámara lee el QR. El sistema compara la hora con el horario y la tolerancia y marca puntual o retardo.', 'Escanear · Manual'],
    ['Sistema', 's', 'Guarda y vigila', 'Sincroniza los registros y levanta alarmas si una credencial se repite, viene de otro teléfono o fue reemplazada.', 'Alarmas de QR'],
    ['Administrativo', '', 'Revisa el día', 'Compara Hoy con la lista, atiende alarmas y corrige errores con motivo.', 'Hoy · Alarmas de QR'],
    ['Prefecto', 'p', 'Registra retiros anticipados', 'Con el documento en papel a la vista: escanea, elige motivo y confirma. Solo si el alumno ya tiene entrada.', 'Retiro anticipado'],
    ['Administrativo', '', 'Cotejan retiros y citan', 'Revisa Retiros del día contra los papeles; cita a tutores por retardos o faltas.', 'Retiros del día · Citatorios'],
    ['Concentrado', 'x', 'Consulta opcional (solo lectura)', 'Si la escuela la activa, el Concentrado consulta CURP, hora de entrada y retiro para mostrarlos en el pase de lista. Nada más.', 'Concentrado'],
  ],
  p: [
    ['Prefecto', 'p', 'Abre el portal y entra a Escanear', 'Permite el uso de la cámara. La lista de alumnos se descarga sola con internet.', 'Escanear'],
    ['Prefecto', 'p', 'Escanea la credencial', 'Verde: puntual. Amarillo: retardo. Si dice «Ya estaba registrado», no se vuelve a pasar.', 'Escanear'],
    ['Prefecto', 'p', 'Sin credencial: registro Manual', 'Busca por nombre y confirma. Queda marcado como manual y el administrativo lo ve.', 'Manual'],
    ['Sistema', 's', 'Guarda y avisa', 'Sin internet guarda en el teléfono y envía al reconectar. Si algo es raro, suena una alarma y se avisa al administrativo.', 'Alarmas de QR'],
    ['Prefecto', 'p', 'Retiro anticipado', 'Revisa el documento en papel, escanea, elige motivo, anota quién recogió y confirma.', 'Retiro anticipado'],
    ['Prefecto', 'p', 'Cierra el turno', 'Revisa Hoy: si falta un alumno que sí llegó, lo registra manual o avisa a la administración.', 'Hoy'],
  ],
};
const CAP = {
  a: {
    'Primera semana': ['Revisar Configuración: horario, tolerancia, grados, grupos y encabezado', 'Cargar alumnos y tutores; revisar que todos tengan CURP', 'Imprimir y entregar las credenciales', 'Dar de alta a los prefectos en Usuarios y roles', 'Leer y aceptar el Aviso de privacidad'],
    'Cada día': ['Revisar Hoy y las Alarmas de QR', 'Cotejar los Retiros del día con los documentos en papel', 'Corregir lo que haga falta, siempre con motivo'],
    'Cada semana o mes': ['Revisar Retardos y faltas y emitir citatorios', 'Imprimir reportes para la dirección', 'Revisar la fecha de la licencia en Ayuda y licencia'],
  },
  p: {
    'Antes de empezar': ['Abrir el portal e iniciar sesión', 'Aceptar el Aviso de privacidad la primera vez', 'Probar la cámara con una credencial'],
    'Cada día': ['Escanear la entrada de cada alumno', 'Registrar manualmente a quien no trae credencial', 'Registrar retiros solo con el documento en papel a la vista', 'Revisar Hoy al terminar el turno'],
    'Cuando algo falla': ['Sin internet: seguir escaneando', 'Alarma o mensaje raro: avisar al administrativo', 'Nunca prestar la cuenta a otra persona'],
  },
};
const FAQ = {
  a: [
    ['Un alumno perdió su credencial', 'QR y credenciales: generar una nueva. La anterior deja de servir y, si alguien la usa, aparece en Alarmas.'],
    ['El prefecto se equivocó en un retiro', 'Retiros del día: Corregir (hora, motivo, quién recogió) o Cancelar con una razón. Queda en la Bitácora.'],
    ['Un registro de entrada está mal', 'Hoy: eliminar el registro con motivo y volver a registrar la entrada correcta.'],
    ['Se acerca el fin de la licencia', 'Ayuda y licencia muestra la fecha. Hay 15 días de gracia; después la escuela queda en solo lectura.'],
    ['Cambió el horario', 'Configuración: horario de entrada y tolerancia. Aplica a los registros nuevos.'],
    ['Se va un prefecto', 'Usuarios y roles: dar de baja su cuenta. Nunca se puede dar de baja al último administrativo.'],
  ],
  p: [
    ['No hay internet', 'Sigue escaneando: el teléfono guarda y envía después. El Retiro anticipado sí necesita internet.'],
    ['El alumno no trae credencial', 'Manual: busca por nombre. Si no aparece, avisa al administrativo.'],
    ['Dice «Credencial vieja»', 'Ya se hizo una reposición de ese QR. Pide la credencial nueva y avisa al administrativo.'],
    ['Dice «Sin entrada hoy» al registrar un retiro', 'Ese alumno no ha entrado. Pide al administrativo que revise antes de dejarlo salir.'],
    ['Dice «Ya estaba registrado»', 'No pasa nada: la entrada ya existe. No lo vuelvas a escanear.'],
    ['La cámara no abre', 'Permite el uso de la cámara en el navegador. Mientras tanto usa Manual.'],
  ],
};

export function render(root) {
  const r = isAdmin() ? 'a' : 'p';
  const info = ROLES[r];
  let tab = 'mapa';
  const panel = h('div');
  const tabs = [['mapa', 'Mapa del portal'], ['flujo', 'Flujo de la información'], ['cap', 'Capacitación']]
    .map(([k, t]) => h('button', { class: 'gd-tab', 'aria-selected': String(k === tab), data: { t: k }, onclick: () => { tab = k; draw(); } }, t));

  const list = items => h('ul', { class: 'gd-check' }, items.map(x => h('li', null, x)));

  function draw() {
    tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === tab)));
    clear(panel);
    if (tab === 'mapa') {
      panel.append(h('div', { class: 'gd-map' }, Object.entries(MAPA).map(([g, rows]) => {
        const items = rows.filter(x => x[2].includes(r));
        return items.length ? h('div', { class: 'gd-card' }, h('h3', null, g),
          h('ul', { class: 'gd-list' }, items.map(([n, d]) => h('li', null, h('b', null, n), h('span', null, d))))) : null;
      })));
    } else if (tab === 'flujo') {
      panel.append(h('div', { class: 'gd-flow' }, FLUJO[r].flatMap(([who, cls, title, text, where], i) => [
        i ? h('div', { class: 'gd-arrow', 'aria-hidden': 'true' }, '↓') : null,
        h('div', { class: 'gd-step' }, h('div', { class: 'gd-who ' + cls }, who),
          h('div', { class: 'gd-what' }, h('b', null, title), h('p', null, text), h('div', { class: 'gd-where' }, 'Pantalla: ' + where))),
      ])));
    } else {
      panel.append(h('div', { class: 'gd-map' }, Object.entries(CAP[r]).map(([k, v]) => h('div', { class: 'gd-card' }, h('h3', null, k), list(v)))),
        h('h3', { class: 'gd-h' }, 'Qué hacer si…'),
        h('div', { class: 'gd-map' }, FAQ[r].map(([q, a]) => h('div', { class: 'gd-card' }, h('h3', null, q), h('p', { class: 'muted small' }, a)))),
        h('div', { class: 'note gd-note' }, 'La autorización de salida es un documento en papel de la escuela. El portal no la emite ni la valida: ' + (r === 'p' ? 'solo registra lo que el prefecto ya revisó.' : 'sirve para cotejar lo que el prefecto registró.')));
    }
  }

  root.append(h('section', { class: 'view' },
    h('div', { class: 'gd-card' }, h('h2', null, info.title), h('p', { class: 'muted' }, info.text), list(info.can)),
    h('div', { class: 'gd-tabs', role: 'tablist' }, tabs), panel));
  draw();
}
