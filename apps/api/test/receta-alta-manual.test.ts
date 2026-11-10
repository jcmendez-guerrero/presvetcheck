import { describe, expect, it } from 'vitest';
import { ACTIVA, ALTA, altaManual, api, datosManuales, entorno } from './entorno';

describe('Alta manual de recetas: acceso y datos del alta', () => {
  it.each([
    ['motivo corto', { ...ALTA, motivo: 'corto' }],
    ['papel sin custodia', { ...ALTA, custodiaPapel: '' }],
    ['electrónica sin plataforma', { tipo: 'electronica', motivo: ALTA.motivo, idPlataforma: 'X-1' }],
  ])('rechaza el alta con %s', async (_caso, cuerpo) => {
    const { app } = await entorno(ACTIVA);
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/recetas/manual', cuerpo);
    expect(r.status).toBe(400);
  });

  it.each(['dev-empleado', 'dev-admin'] as const)('%s no puede dar de alta', async (u) => {
    const { app } = await entorno(ACTIVA);
    const r = await api(app, u, 'POST', '/api/recetas/manual', ALTA);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('PROHIBIDO');
  });

  it('con el alta manual desactivada responde ALTA_MANUAL_DESHABILITADA', async () => {
    const { app } = await entorno();
    const r = await api(app, 'dev-veterinaria', 'POST', '/api/recetas/manual', ALTA);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('ALTA_MANUAL_DESHABILITADA');
  });

  it('crea la receta sin imagen, con origen manual', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const g = await api(app, 'dev-veterinaria', 'GET', `/api/recetas/${id}`);
    expect(g.status).toBe(200);
    expect(g.json).toMatchObject({
      origen: 'manual',
      motivoAlta: ALTA.motivo,
      custodiaPapel: ALTA.custodiaPapel,
      imagenes: [],
      estado: 'BORRADOR',
    });
  });

  it('un empleado no puede abrir una receta de alta manual', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const r = await api(app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
    expect(r.status).toBe(403);
  });
});

describe('Alta manual de recetas: datos de CIMAVet obligatorios', () => {
  it('exige elegir el medicamento de CIMAVet en cada línea', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-SINCN');
    datos.lineas = [{ orden: 1, medicamentoTexto: 'Clavubay escrito a mano' }];
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('MEDICAMENTO_NO_SELECCIONADO');
  });

  it('rechaza un código nacional que no está en CIMAVet', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-CNMALO');
    datos.lineas = [{ orden: 1, cn: '123456' }];
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.json.error.code).toBe('MEDICAMENTO_NO_SELECCIONADO');
  });

  it('exige elegir la especie de CIMAVet', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-SINESP', { especie: { texto: 'Perro', especieId: null } });
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('ESPECIE_NO_SELECCIONADA');
  });

  it('rechaza una especie que no está en la lista de CIMAVet', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-ESPX', { especie: { texto: 'Inventada', especieId: 99999 } });
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('ESPECIE_NO_SELECCIONADA');
  });

  it('sustituye forma, principio activo y concentración escritos a mano por los de CIMAVet', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-CIMA');
    datos.lineas = datos.lineas!.map((l) => ({
      ...l,
      formaTexto: 'jarabe inventado',
      principioActivoTexto: 'agua',
      concentracionTexto: '1 mg',
      nregistro: 'OTRO',
    }));
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.status).toBe(200);
    const g = await api(app, 'dev-veterinaria', 'GET', `/api/recetas/${id}`);
    const l = g.json.confirmacion.lineas[0];
    expect(l.nregistro).toBe('1868 ESP');
    expect(l.formaTexto).not.toBe('jarabe inventado');
    expect(l.principioActivoTexto).toMatch(/amoxicilina/i);
    expect(l.concentracionTexto).not.toBe('1 mg');
  });

  it('evalúa la receta manual con el mismo motor que una escaneada', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datosManuales('RM-EVAL'));
    const ev = await api(app, 'dev-veterinaria', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.status).toBe(200);
    expect(ev.json.lineas[0].resultado).toHaveProperty('decision');
    expect(ev.json.lineas[0].resultado).toHaveProperty('reglaVersion');
  });
});

describe('Alta manual de recetas: fecha de entrega', () => {
  it.each([
    ['sin fecha', null],
    ['posterior a hoy', '2026-10-15'],
    ['anterior a la emisión', '2026-09-30'],
  ])('al confirmar, rechaza la fecha de entrega %s', async (_caso, fechaOriginal) => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const r = await api(
      app,
      'dev-veterinaria',
      'PUT',
      `/api/recetas/${id}/confirmacion`,
      datosManuales(`RM-FE${fechaOriginal}`, { fechaOriginal }),
    );
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('FECHA_ORIGINAL_INVALIDA');
  });

  it('el resultado se calcula en la fecha de entrega guardada (sin caducidad aunque hoy lo estaría)', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datosManuales('RM-RES'));
    const ev = await api(app, 'dev-veterinaria', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(JSON.stringify(ev.json.lineas[0].incidencias)).not.toContain('RECETA_CADUCADA');
  });
});

describe('Alta manual de recetas: borrador', () => {
  it('guarda el borrador incompleto sin perder lo escrito, pero sin texto libre en los campos de CIMAVet', async () => {
    const { app } = await entorno(ACTIVA);
    const id = await altaManual(app);
    const datos = datosManuales('RM-BORR', {
      comprobadoConOriginal: false,
      especie: { texto: null, especieId: null },
    });
    datos.lineas = [{ orden: 1, formaTexto: 'jarabe inventado', cantidadEnvases: 2 }];
    const r = await api(app, 'dev-veterinaria', 'PUT', `/api/recetas/${id}/confirmacion`, datos);
    expect(r.status).toBe(200);
    const g = await api(app, 'dev-veterinaria', 'GET', `/api/recetas/${id}`);
    expect(g.json.confirmacion.numero).toBe('RM-BORR');
    expect(g.json.confirmacion.lineas[0]).toMatchObject({ cantidadEnvases: 2, formaTexto: null });
  });
});
