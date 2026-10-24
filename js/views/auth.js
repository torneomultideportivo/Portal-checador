// Pantallas de acceso: entrar, registrarse con código, recuperar contraseña, cuenta pendiente.
import { h, clear, toast, guard, icon } from '../ui.js';
import { authApi, rpc } from '../api.js';
import { errMsg } from '../logic.js';
import { modal } from '../ui.js';
import { privacyBodyEl } from './privacy.js';
import { APP_NAME } from '../config.js';

const ROLE_TXT = { school_admin: 'Administrativo de la escuela', prefect: 'Prefecto / personal de puerta', super_admin: 'Administrador general' };

function shell(...kids) {
  return h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, icon('scan', 28)), h('h1', null, APP_NAME)), ...kids));
}

export const openNotice = () => modal({ title: 'Aviso de privacidad', wide: true, body: h('div', { class: 'privacy-scroll' }, privacyBodyEl(null)) });

export function renderAuth(root, { onLogged, initial = 'login' }) {
  let tab = initial;
  const draw = () => {
    clear(root);
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: tab === 'login' ? 'on' : '', onclick: () => { tab = 'login'; draw(); } }, 'Entrar'),
      h('button', { class: tab === 'register' ? 'on' : '', onclick: () => { tab = 'register'; draw(); } }, 'Registrarme'));
    root.append(shell(tabs, tab === 'login' ? loginForm() : tab === 'register' ? registerForm() : forgotForm(),
      h('p', { class: 'center small' }, h('a', { href: '#', onclick: e => { e.preventDefault(); openNotice(); } }, 'Aviso de privacidad'))));
  };

  const field = (label, props) => h('label', { class: 'field' }, h('span', null, label), h('input', { class: 'input', ...props }));

  function loginForm() {
    const email = field('Correo', { type: 'email', autocomplete: 'username', required: true });
    const pass = field('Contraseña', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
    return h('form', {
      onsubmit: e => { e.preventDefault(); guard(btn, async () => { await authApi.signIn(email.querySelector('input').value.trim(), pass.querySelector('input').value); await onLogged(); }); },
    }, email, pass, btn,
    h('button', { type: 'button', class: 'link', onclick: () => { tab = 'forgot'; draw(); } }, '¿Olvidaste tu contraseña?'));
  }

  function registerForm() {
    const name = field('Nombre completo', { type: 'text', autocomplete: 'name', required: true, minLength: 3 });
    const email = field('Correo', { type: 'email', autocomplete: 'email', required: true });
    const pass = field('Contraseña (mínimo 8 caracteres)', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
    const pass2 = field('Repite la contraseña', { type: 'password', autocomplete: 'new-password', required: true, minLength: 8 });
    const code = field('Código de tu escuela', { type: 'text', autocomplete: 'off', placeholder: 'ADM-XXXX-XXXX-XXXX  o  PRE-XXXX-XXXX-XXXX', style: { textTransform: 'uppercase' } });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Crear mi cuenta');
    const $v = f => f.querySelector('input').value.trim();
    const acc = h('input', { type: 'checkbox', required: true });
    return h('form', {
      onsubmit: e => {
        e.preventDefault();
        guard(btn, async () => {
          if (!acc.checked) throw new Error('Debes aceptar el aviso de privacidad para crear tu cuenta.');
          if ($v(pass) !== pass2.querySelector('input').value) throw new Error('Las contraseñas no coinciden.');
          const v = await rpc('validate_signup', { p_email: $v(email), p_code: $v(code) });
          if (!v.valid) throw new Error('CODIGO_INVALIDO');
          await authApi.signUp({ email: $v(email), password: pass.querySelector('input').value, fullName: $v(name), code: $v(code).toUpperCase() });
          clear(root);
          root.append(shell(
            h('h2', null, 'Revisa tu correo'),
            h('p', null, `Te enviamos un enlace de confirmación a ${$v(email)}. Ábrelo y después regresa aquí para entrar.`),
            h('p', { class: 'muted' }, `Te registraste como: ${ROLE_TXT[v.role]}${v.school ? ' — ' + v.school : ''}.`),
            h('button', { class: 'btn block', onclick: () => { tab = 'login'; draw(); } }, 'Ir a Entrar')));
        });
      },
    }, name, email, pass, pass2, code,
    h('p', { class: 'hint' }, 'El código te lo entrega el administrativo de tu escuela. Sin código no se puede crear la cuenta.'),
    h('label', { class: 'chk big' }, acc, h('span', null, ' He leído y acepto el ', h('a', { href: '#', onclick: e => { e.preventDefault(); openNotice(); } }, 'aviso de privacidad'), '.')),
    btn);
  }

  function forgotForm() {
    const email = field('Correo de tu cuenta', { type: 'email', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Enviarme el enlace');
    return h('form', {
      onsubmit: e => { e.preventDefault(); guard(btn, async () => { await authApi.resetPassword(email.querySelector('input').value.trim()); toast('Si el correo existe, te enviamos un enlace para cambiar la contraseña.', 'ok', 6000); tab = 'login'; draw(); }); },
    }, h('p', null, 'Te enviaremos un enlace para crear una contraseña nueva.'), email, btn,
    h('button', { type: 'button', class: 'link', onclick: () => { tab = 'login'; draw(); } }, 'Volver'));
  }
  draw();
}

export function renderRecovery(root, { onDone }) {
  clear(root);
  const p1 = h('input', { class: 'input', type: 'password', minLength: 8, required: true, autocomplete: 'new-password' });
  const p2 = h('input', { class: 'input', type: 'password', minLength: 8, required: true, autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Guardar contraseña');
  root.append(shell(h('h2', null, 'Crea tu nueva contraseña'), h('form', {
    onsubmit: e => { e.preventDefault(); guard(btn, async () => { if (p1.value !== p2.value) throw new Error('Las contraseñas no coinciden.'); await authApi.updatePassword(p1.value); toast('Contraseña actualizada', 'ok'); await onDone(); }); },
  }, h('label', { class: 'field' }, h('span', null, 'Nueva contraseña (mínimo 8)'), p1), h('label', { class: 'field' }, h('span', null, 'Repítela'), p2), btn)));
}

export function renderBlocked(root, { status, email, onLogout, onRetry }) {
  clear(root);
  const msg = {
    PENDIENTE: ['Cuenta pendiente', 'Tu cuenta aún no está activa. Confirma tu correo con el enlace que te enviamos. Si ya lo confirmaste y eres administrativo, es posible que el código ya se haya usado o haya vencido: pide uno nuevo.'],
    BAJA: ['Cuenta dada de baja', 'Esta cuenta ya no tiene acceso. Si crees que es un error, habla con el administrativo de tu escuela.'],
    SIN_PERFIL: ['Cuenta sin escuela', 'Tu usuario existe pero no está ligado a ninguna escuela. Pide a tu administrativo un código y regístrate de nuevo con otro correo.'],
  }[status] || ['Sin acceso', 'No se pudo verificar tu cuenta.'];
  root.append(shell(h('h2', null, msg[0]), h('p', null, msg[1]), email ? h('p', { class: 'muted' }, email) : null,
    h('button', { class: 'btn block', onclick: onRetry }, 'Volver a comprobar'),
    h('button', { class: 'btn block', onclick: onLogout }, 'Cerrar sesión')));
}

export function renderSetup(root) {
  clear(root);
  root.append(shell(h('h2', null, 'Falta configurar la conexión'),
    h('p', null, 'Abre el archivo js/config.js y pega la dirección (URL) y la llave pública (anon) de tu proyecto de Supabase. La guía paso a paso está en el archivo LEEME.md.')));
}
