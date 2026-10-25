# Checador de asistencia con QR — Guía de instalación (paso a paso)

Contenido
- `supabase/INSTALAR.sql` → toda la base de datos en un solo archivo.
- `web/` → la aplicación (se sube a GitHub Pages).
- `mantener-supabase-activo.yml` → aviso automático para que Supabase no se pause (va en `.github/workflows/` del repositorio, ver paso 5).
- `datos/plantilla_alumnos.xlsx` y `datos/plantilla_personal.xlsx` → plantillas para cargar alumnos (con tutores) y personal.

## 1. Crear la base de datos (Supabase)
1. supabase.com → **New project** (nombre `checador`; guarda la contraseña).
2. **SQL Editor → New query**. Pega TODO `supabase/INSTALAR.sql` → **Run**. Debe decir "Success".
3. En otra consulta nueva (con TU correo, el mismo con el que te registrarás):
   `insert into public.super_admin_emails (email) values ('carlos.villalobos.mej@oax.nuevaescuela.mx');`
   **Esto se hace ANTES de registrarte en la app.**

## 2. Configurar el correo
- **Authentication → Providers → Email**: deja activado "Confirm email".
- **Authentication → URL Configuration**: en *Site URL* pon la dirección final de la app (paso 4) y agrégala en *Redirect URLs*.
- El correo gratuito de Supabase manda muy pocos mensajes por hora. Antes de usarlo con varias escuelas configura uno propio en **Authentication → SMTP Settings** (Brevo, Resend, Gmail…).

## 3. Conectar la app
1. Supabase → **Project Settings → API**: copia *Project URL* y la llave *anon public*.
2. Abre `web/js/config.js` y reemplaza `TU-PROYECTO…` y `TU-LLAVE-ANON-PUBLICA`. Es el único archivo que se edita. **Nunca pegues la llave `service_role`.**

## 4. Publicar la app (GitHub Pages)
1. Crea un repositorio en GitHub. Sube el CONTENIDO de `web/` (que `index.html` quede en la raíz del repositorio) (el aviso del paso 5 se sube aparte).
2. **Settings → Pages → Deploy from a branch → main / (root)**. En unos minutos tendrás `https://tuusuario.github.io/repositorio/`.
3. Pon esa dirección en *Site URL* del paso 2. (Hace falta https para la cámara y el modo sin internet.)
4. Cuando publiques una versión nueva, cambia `VERSION` en `web/sw.js` para que los celulares la descarguen.

## 5. Que Supabase no se pause (aviso automático)
En GitHub: **Add file → Create new file**, escribe el nombre `.github/workflows/mantener-supabase-activo.yml` (al teclear las diagonales se crean las carpetas), pega el contenido del archivo `mantener-supabase-activo.yml` de este paquete y **Commit**.

En el repositorio de GitHub: **Settings → Secrets and variables → Actions → New repository secret** y crea dos:
- `SUPABASE_URL` → el *Project URL*.
- `SUPABASE_ANON_KEY` → la llave *anon public*.

Luego **Actions → Mantener Supabase activo → Run workflow** para probarlo (debe salir en verde). Después corre solo cada 3 días. En la app, **Seguridad** (super administrador) muestra la fecha del último aviso y se pone en rojo si pasan más de 5 días sin uno.

## 6. Primer uso
1. Abre la app → **Registrarme** con tu correo (el del paso 1.3), acepta el aviso de privacidad y confirma desde tu correo. Entras como **super administrador**.
2. **Escuelas → Nueva escuela** (nombre y CCT). Genera el **código de administrativo** (`ADM-…`, un solo uso, vence en 7 días) y entrégalo a esa persona.
3. El administrativo entra a **Configuración** y captura: director, subdirector (nombres **y teléfonos**, obligatorios para los citatorios), domicilio, código postal, logotipos (IEEPO y escuela), hora de entrada de alumnos, tolerancia, grados y grupos. Aquí también está el **interruptor de entrada del personal con QR** (apagado de inicio), su tolerancia, los minutos de la alarma y desde cuántos retardos/faltas se sugiere citar.
4. **Alumnos → Importar Excel**: usa `plantilla_alumnos.xlsx` (una fila por alumno con apellidos, nombres, grado, grupo, lengua indígena y hasta dos tutores MDR/PDR/TUL). Borra la fila de ejemplo. **Personal → Importar Excel**: `plantilla_personal.xlsx` (CURP, nombre, puesto y la hora de entrada de cada persona).
5. **QR y credenciales**: imprime las etiquetas QR de 3 × 3 cm con nombre (30 por hoja carta) y pégalas en las credenciales laminadas.
6. **Prefectos**: en *Usuarios y roles* está el código `PRE-…` (reutilizable) para que se registren.

## 7. Uso diario
- Puerta: **Escanear** (una sola pantalla para alumnos y personal). Verde = puntual, naranja = retardo, azul = ya registrado, gris = personal con la función apagada.
- **Alarma roja** (suena y vibra, no borra nada): el mismo QR en otro teléfono, el mismo QR otra vez pasados N minutos, una credencial reemplazada, o un QR desconocido. El administrativo las revisa en **Alarmas de QR**.
- Sin internet sigue registrando y la alarma local también funciona; al volver la conexión se envía solo.
- Los celulares deben tener **fecha y hora en automático**.
- **Reposición**: en el alumno o la persona, "Reposición de QR" genera uno nuevo y el anterior queda invalidado.
- **Retardos y faltas** → **Citatorios** (3 por hoja; individual, por grado y grupo o toda la escuela; un citatorio por familia). **Felicitaciones**: cumpleaños por rango de fechas (mes en curso por defecto) y el botón de festejo con Las Mañanitas.

## 8. Privacidad y seguridad
- **Aviso de privacidad**: es un BORRADOR. Debe revisarlo la dirección o un asesor jurídico antes de usarlo. Cada usuario lo acepta al entrar, y la pantalla permite imprimirlo y llevar el control de entrega a las familias.
- La CURP, la lengua indígena y los tutores solo los ve el administrativo; el prefecto solo ve nombre, grado y grupo al escanear.
- **Respaldo mensual**: **Seguridad → Descargar respaldo** (Excel con alumnos, tutores, personal y asistencias). La app avisa cuando pasa más de un mes. Guarda el archivo con cuidado: tiene datos personales.

## Pendiente de la escuela
Formatos oficiales de citatorio y credencial, logotipos en PNG con fondo transparente, nombre y teléfonos reales del subdirector y código postal. Las fotos en pantalla de escaneo se agregan cuando exista la autorización.

## Pruebas realizadas
Base de datos 174 pruebas (90 + 84), lógica 20 pruebas y recorrido de todas las pantallas con datos de ejemplo. Haz una prueba real con 2 o 3 credenciales antes del primer día de uso.

## Licencias y soporte (versión 2.4.0)
- Base de datos (escuela ya instalada): ejecutar **supabase/schema_v3.sql** en el SQL Editor de Supabase (se puede repetir sin riesgo). Instalación nueva: INSTALAR.sql.
- Una licencia por CCT, anual (vence el 31 de julio), 15 días de gracia y luego solo lectura. No hay montos en el sistema: el precio se trata en persona.
- Pantalla **Licencias** (administrador general): estado de cada escuela, registrar pago (genera la clave de un solo uso), avisos por WhatsApp, suspender, solicitudes de ayuda y bitácora de accesos.
- Pantalla **Ayuda y licencia** (administrativo): ver su licencia, pedir ayuda y autorizar 3 días de acceso a soporte (revocable).
- El administrador general NO ve alumnos de otras escuelas salvo la escuela propia (gratuita) o con autorización de soporte vigente.
- WhatsApp de soporte: se cambia desde la pantalla Licencias.

## Varios administrativos (versión 2.6.0)
- Base de datos ya instalada: ejecutar **supabase/schema_v4.sql** (formato del citatorio) y luego **supabase/schema_v5.sql** (varios administrativos). Cada uno se puede repetir sin riesgo.
- Hasta 4 administrativos por escuela, todos con los mismos permisos. Una clave ADM nueva suma a otro; ya no reemplaza al actual.
- En "Usuarios y roles" el administrativo genera claves, agrega prefectos como administrativos y da de baja a otros. Nunca se puede dar de baja al último.
