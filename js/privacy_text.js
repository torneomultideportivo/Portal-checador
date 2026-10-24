// Texto del aviso de privacidad (BORRADOR). Debe revisarlo el área jurídica o de transparencia del IEEPO
// o de la supervisión antes de usarse de forma oficial: la ley aplicable a escuelas públicas puede pedir texto específico.
export const PRIVACY_VERSION = 'v1';

export function privacySections(school) {
  const s = school || {};
  const nombre = s.name ? `${s.name}${s.cct ? ', CCT ' + s.cct : ''}` : 'la escuela donde se registra (nombre y clave en su aviso impreso)';
  const dom = s.address ? `${s.address}${s.postal_code ? ', C.P. ' + s.postal_code : ''}${s.locality ? ', ' + s.locality : ''}` : '[domicilio de la escuela]';
  const dir = s.director ? `${s.director}${s.director_phone ? ' · tel. ' + s.director_phone : ''}` : '[director(a) y teléfono]';
  return [
    ['1 · Responsable', `${nombre}. Domicilio: ${dom}. Dirección: ${dir}.`],
    ['2 · Datos personales que se recaban', 'Alumnos: CURP, nombre, grado y grupo, lengua indígena que habla (si la hay), fecha y hora de entrada. Madres, padres o tutores: CURP, nombre y parentesco. Personal de la escuela: CURP, nombre, puesto y, si la escuela lo activa, hora de entrada. Cuentas del sistema: correo, nombre y registros de uso (quién escaneó, desde qué teléfono y a qué hora).'],
    ['3 · Datos sensibles', 'La lengua indígena puede relacionarse con el origen étnico. Se recaba solo para atención educativa, la ve únicamente el administrativo de la escuela y no se muestra en pantallas de escaneo ni en felicitaciones.'],
    ['4 · Finalidades', 'Control de asistencia y puntualidad; comunicación y citatorios a madres, padres o tutores; felicitaciones de cumpleaños (del personal solo se muestra nombre, día y mes); estadística interna y reportes escolares. No se usan para fines comerciales.'],
    ['5 · Transferencias', 'No se venden ni se ceden a terceros. Solo se comparten con la autoridad educativa cuando la ley lo exija.'],
    ['6 · Derechos ARCO', `Acceder, rectificar, cancelar u oponerse al tratamiento de sus datos, presentando solicitud en la dirección de la escuela (${dom}).`],
    ['7 · Medidas de seguridad', 'Acceso por roles y contraseñas, comunicación cifrada (HTTPS), información separada por escuela, datos privados visibles solo para el administrativo, bitácora de movimientos y respaldos periódicos.'],
    ['8 · Menores de edad', 'Los datos de alumnos se tratan con conocimiento de sus madres, padres o tutores, quienes pueden consultar este aviso en la escuela y ejercer sus derechos por ellos.'],
    ['9 · Cambios al aviso', 'Cualquier cambio se publicará en el sistema con nueva fecha y versión; se pedirá de nuevo la aceptación a las cuentas.'],
  ];
}
