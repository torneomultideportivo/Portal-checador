// Almacenamiento local del celular (IndexedDB): lista de alumnos, asistencia de hoy
// y la COLA de registros que aún no se han enviado al servidor.
const NAME = 'checador', VERSION = 1;
const STORES = { kv: undefined, students: 'id', today: 'student_id', queue: 'cid', failed: 'cid' };
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, key] of Object.entries(STORES)) {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, key ? { keyPath: key } : undefined);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const kvGet = key => run('kv', 'readonly', s => s.get(key));
export const kvSet = (key, val) => run('kv', 'readwrite', s => s.put(val, key));
export const kvDel = key => run('kv', 'readwrite', s => s.delete(key));
export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, val) => run(store, 'readwrite', s => s.put(val));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const count = store => run(store, 'readonly', s => s.count());
export async function replaceAll(store, items) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    s.clear();
    for (const it of items) s.put(it);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
export async function clearStores(names) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(names, 'readwrite');
    names.forEach(n => t.objectStore(n).clear());
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
