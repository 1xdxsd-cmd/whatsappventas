import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerReemplazo, opcionesDeReemplazo, textoOpcionesDeReemplazo } from '../src/admin/reemplazo.js';

test('opciones de reemplazo: misma plataforma y tipo, con lugar, sin la caída', () => {
  const cuentas = [
    { id: 'a', platform: 'netflix', email: 'caida@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 1 },
    { id: 'b', platform: 'netflix', email: 'b@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 4 },
    { id: 'c', platform: 'netflix', email: 'c@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 1 },
    { id: 'd', platform: 'netflix', email: 'd@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 5 },
    { id: 'e', platform: 'netflix', email: 'e@x.com', saleType: 'cuenta', capacity: 1, usedProfiles: 0 },
    { id: 'f', platform: 'disney', email: 'f@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 0 },
    { id: 'g', platform: 'netflix', email: 'g@x.com', saleType: 'perfil', capacity: 5, usedProfiles: 0, suspended: true },
  ];
  const opciones = opcionesDeReemplazo(cuentas, { platform: 'netflix', type: 'perfil', accountId: 'a', email: 'caida@x.com' });
  assert.deepEqual(opciones, [
    { id: 'c', email: 'c@x.com', libres: 4 },
    { id: 'b', email: 'b@x.com', libres: 1 },
  ]);
  const texto = textoOpcionesDeReemplazo({ id: 3, plataforma: 'netflix', opciones });
  assert.match(texto, /\*1\.\* c@x\.com \(4 libres\)\n\*2\.\* b@x\.com \(1 libre\)/);
  assert.match(texto, /\/reemplazar 3 correo contraseña/);
  assert.match(textoOpcionesDeReemplazo({ id: 3, plataforma: 'netflix', opciones: [] }), /No hay cuentas de Netflix libres/);
});

test('lee lo que va después de /reemplazar N', () => {
  assert.deepEqual(leerReemplazo('2'), { opcion: 2 });
  assert.deepEqual(leerReemplazo('a@x.com Clave1'), { email: 'a@x.com', password: 'Clave1', perfiles: null });
  assert.deepEqual(leerReemplazo('a@x.com Clave1 4'), { email: 'a@x.com', password: 'Clave1', perfiles: 4 });
  assert.equal(leerReemplazo(''), null);
  assert.equal(leerReemplazo('hola mundo'), null);
});
