import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvent, discrepancia, dispensacion, propietario, receta, verifyAuditChain } from '@mmx/db';
import { api, confirmar, crearReceta, entorno, multipart, recetaCorrecta, type Entorno } from './entorno';

let E: Entorno;
beforeAll(async () => {
  E = await entorno();
}, 180_000);
afterAll(async () => {
  await E.app.close();
});

const envase = (o: Record<string, unknown> = {}) => ({
  lote: 'CLV-2611',
  caducidad: '2026-11-30',
  unidades: 1,
  metodoCaptura: 'camara',
  cnEscaneado: '570016',
  ...o,
});
const dispensar = (u: Parameters<typeof api>[1], body: Record<string, unknown>, mfa = false) =>
  api(
    E.app,
    u,
    'POST',
    '/api/dispensaciones',
    { conReceta: true, lineaOrden: 1, cn: '570016', envases: [envase()], ...body },
    { mfa },
  );

describe('sondas, autenticación y roles', () => {
  it('health/ready públicos; sin x-dev-user → 401; rol insuficiente → 403', async () => {
    expect((await api(E.app, null, 'GET', '/api/health')).json).toEqual({ status: 'ok' });
    expect((await api(E.app, null, 'GET', '/api/ready')).status).toBe(200);
    expect((await api(E.app, null, 'GET', '/api/config/publica')).json).toMatchObject({
      authMode: 'dev',
      extractor: 'fake',
      modoSustitucion: 'POST',
    });
    expect((await api(E.app, null, 'GET', '/api/inicio')).status).toBe(401);
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/me')).json).toMatchObject({
      id: 'dev-empleado',
      roles: ['empleado'],
    });
    // El admin no participa en la operativa ni autoriza sustituciones (SPEC §9.1).
    expect(
      (
        await api(E.app, 'dev-admin', 'POST', '/api/dispensaciones', {
          conReceta: false,
          canal: 'presencial',
          cn: '570025',
          envases: [envase()],
        })
      ).status,
    ).toBe(403);
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/admin/reglas')).status).toBe(403);
    // El farmacéutico garante no tiene usuario en la app.
    expect((await api(E.app, 'dev-garante' as never, 'GET', '/api/me')).status).toBe(401);
  });

  it('OpenAPI generado con las rutas de SPEC §7', async () => {
    const o = (await api(E.app, null, 'GET', '/api/openapi.json')).json as { paths: Record<string, unknown> };
    for (const p of [
      '/api/recetas',
      '/api/recetas/{id}/confirmacion',
      '/api/recetas/{id}/evaluar',
      '/api/medicamentos/buscar',
      '/api/stock/{cn}/fefo',
      '/api/scan/parse',
      '/api/dispensaciones',
      '/api/dispensaciones/{id}/anular',
      '/api/recepciones',
      '/api/registros/salidas',
    ]) {
      expect(o.paths).toHaveProperty(p);
    }
  });

  it('errores de validación sin eco de los datos enviados', async () => {
    const r = await api(E.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: false,
      canal: 'online',
      cn: 'abc',
      envases: [],
      propietario: { dni: '12345678Z' },
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).not.toContain('12345678Z');
  });
});

describe('receta → revisión → resultado → dispensación', () => {
  let id: string;

  it('crea la receta, guarda la imagen y prellena el borrador sin marcar firma ni comprobación', async () => {
    id = await crearReceta(E.app);
    const r = await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
    expect(r.json.estado).toBe('EXTRAIDA');
    expect(r.json.confirmacion.firmaConfirmada).toBe(false);
    expect(r.json.confirmacion.comprobadoConOriginal).toBe(false);
    expect(r.json.dudosos).toContain('receta.titularTelefono');
    expect(r.json.imagenes).toHaveLength(1);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}/imagenes/1`)).res.headers['content-type'],
    ).toBe('image/png');
    // Titular y extracción cifrados en la BD (SPEC §9.2).
    const [row] = await E.h.db.select().from(receta).where(eq(receta.id, id));
    expect(JSON.stringify(row!.extraccion)).not.toContain('Titular de demostración');
    expect(JSON.stringify(row!.confirmacion)).not.toContain('Titular de demostración');
  });

  it('sin confirmar datos → NO_CONFORME con DATOS_NO_COMPROBADOS (no forzable)', async () => {
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('NO_CONFORME');
    expect(ev.json.lineas[0].resultado.evidencias.forzable).toBe(false);
  });

  it('comprobar (antes de «Ver qué dispensar»): avisa de la firma sin confirmar y no evalúa ni guarda', async () => {
    await confirmar(E.app, id, (r) => ({ ...recetaCorrecta('R-SIN-FIRMA')(r), firmaConfirmada: false }));
    const c = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/comprobar`);
    expect(c.status).toBe(200);
    expect(c.json.incidencias.map((i: { code: string }) => i.code)).toContain('FIRMA_FALTA');
    expect(c.json.incidencias.every((i: { severidad: string }) => i.severidad !== 'AVISO')).toBe(true);
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.estado).toBe('CONFIRMADA'); // no pasa a EVALUADA
    await confirmar(E.app, id, recetaCorrecta('R-SIN-FIRMA'));
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/comprobar`)).json.incidencias,
    ).toEqual([]);
  });

  it('receta de compañía completa con stock → DISPENSAR con el lote FEFO', async () => {
    await confirmar(E.app, id, recetaCorrecta('R-COMPLETA'));
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.status).toBe(200);
    const l = ev.json.lineas[0];
    expect(l.resultado.decision).toBe('DISPENSAR');
    expect(l.resultado.evidencias.lotes.recomendado.lote).toBe('CLV-2611');
    // El Nomenclátor no informa problemas de suministro y en los tests no hay CIMAVet en vivo: se avisa.
    expect(l.resultado.motivos.map((m: { code: string }) => m.code)).toContain('SUMINISTRO_NO_COMPROBADO');
    expect(ev.json.validez).toMatchObject({ caso: 'antimicrobiano', efectiva: '2026-10-18' });
    expect(ev.json.reglaVersion).toMatch(/^receta-campos\.v1@/);
  });

  it('lote distinto al FEFO sin motivo → 422; escaneo con CN distinto → bloqueo forzable', async () => {
    const sinMotivo = await dispensar('dev-empleado', {
      recetaId: id,
      envases: [envase({ lote: 'CLV-2705', caducidad: '2027-05-31' })],
    });
    expect(sinMotivo.status).toBe(422);
    expect(sinMotivo.json.error.code).toBe('MOTIVO_LOTE_OBLIGATORIO');
    const cnMal = await dispensar('dev-empleado', {
      recetaId: id,
      envases: [envase({ cnEscaneado: '570017' })],
    });
    expect(cnMal.status).toBe(422);
    expect(cnMal.json.error).toMatchObject({
      code: 'DISPENSACION_BLOQUEADA',
      detalles: { forzables: ['CN_ESCANEADO_DISTINTO'] },
    });
  });

  it('dispensa, registra la salida inmutable y recuerda el lote para el TPV', async () => {
    const r = await dispensar('dev-empleado', {
      recetaId: id,
      envases: [envase({ lote: 'CLV-2705', caducidad: '2027-05-31', gtin: '08470005700168' })],
      motivoLoteDistinto: 'El otro lote está en reserva',
    });
    expect(r.status).toBe(201);
    expect(r.json.recordatorioTpv).toEqual([
      {
        cn: '570016',
        lote: 'CLV-2705',
        unidades: 1,
        texto: 'Cobrar en el TPV seleccionando el lote CLV-2705',
      },
    ]);
    expect(r.json.avisos).toContain('LOTE_NO_FEFO');
    const [d] = await E.h.db.select().from(dispensacion).where(eq(dispensacion.id, r.json.dispensaciones[0]));
    expect(d).toMatchObject({
      cn: '570016',
      lote: 'CLV-2705',
      loteFefoRecomendado: 'CLV-2611',
      motivoLoteDistinto: 'El otro lote está en reserva',
      forzado: false,
      conReceta: true,
      metodoCaptura: 'camara',
    });
    expect(d!.principioActivoTxt).toBe('amoxicilina trihidrato 459 mg; clavulanato potasio 119 mg');
    // UNIDADES DISPENSADAS del registro de salidas: envase completo descrito.
    expect(d!.unidadesTexto).toBe('1 caja 10 comprimidos');
    const g = await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
    expect(g.json.estado).toBe('DISPENSADA');
  });

  it('unidades escaneadas > prescritas → bloqueo no forzable', async () => {
    const r = await dispensar('dev-empleado', {
      recetaId: id,
      forzado: {
        codigos: ['UNIDADES_SUPERAN_PRESCRITAS'],
        motivo: 'Lo pide el cliente por teléfono',
        aceptaRiesgos: true,
      },
    });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json.error)).toMatch(/UNIDADES_SUPERAN_PRESCRITAS|FORZADO/);
  });

  it('duplicado en papel (mismo nº y colegiado ya dispensado) → NO_CONFORME; forzar un BLOQUEANTE_DURO lo rechaza la API', async () => {
    const id2 = await crearReceta(E.app);
    await confirmar(E.app, id2, recetaCorrecta('R-COMPLETA'));
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id2}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('NO_CONFORME');
    expect(ev.json.lineas[0].resultado.motivos.map((m: { code: string }) => m.code)).toContain(
      'RECETA_YA_DISPENSADA',
    );
    const r = await dispensar('dev-empleado', {
      recetaId: id2,
      forzado: {
        codigos: ['RECETA_YA_DISPENSADA'],
        motivo: 'La UI lo envía igualmente',
        aceptaRiesgos: true,
      },
    });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('FORZADO_NO_PERMITIDO');
    const previa = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id2}/evaluar`, {
      forzados: {
        '1': { codigos: ['RECETA_YA_DISPENSADA'], motivo: 'La UI lo envía igualmente', aceptaRiesgos: true },
      },
    });
    expect(previa.json.error.code).toBe('FORZADO_NO_PERMITIDO');
  });

  it('auditoría encadenada de todo el flujo', async () => {
    const eventos = await E.h.db.select().from(auditEvent);
    expect(eventos.map((e) => e.accion)).toEqual(
      expect.arrayContaining(['receta_crear', 'receta_confirmar', 'receta_evaluar', 'dispensar']),
    );
    expect((await verifyAuditChain(E.h.db)).ok).toBe(true);
  });
});

describe('dispensación fraccionada (guía §5.9)', () => {
  // BENAZECARE SABOR 5 mg (1865 ESP, CN 570361): caja de 28 comprimidos, "fracción: 1 blister de 14 comprimidos".
  const lineaBenazecare =
    (unidadesForma: number | null) => (r: Parameters<ReturnType<typeof recetaCorrecta>>[0]) => {
      const base = recetaCorrecta(`R-FR-${Math.random().toString(36).slice(2, 7)}`)(r);
      return {
        ...base,
        indicacion: 'Insuficiencia renal crónica',
        lineas: base.lineas.map((l) => ({
          ...l,
          cn: '570361',
          nregistro: '1865 ESP',
          cantidadEnvases: null,
          unidadesForma,
        })),
      };
    };
  const envFr = {
    lote: 'BNZ-2709',
    caducidad: '2027-09-30',
    unidades: 1,
    metodoCaptura: 'camara',
    cnEscaneado: '570361',
  };

  it('fracción autorizada (14 comprimidos): registra las unidades y el texto de la fracción; la línea queda dispensada', async () => {
    E.stock.datos['570361'] = [{ lote: 'BNZ-2709', caducidad: '2027-09-30', disponible: 3 }];
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, lineaBenazecare(14));
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('DISPENSAR');
    const mal = await dispensar('dev-empleado', {
      recetaId: id,
      cn: '570361',
      envases: [envFr],
      fraccion: { unidadesForma: 7 },
    });
    expect(mal.status).toBe(422);
    expect(mal.json.error).toMatchObject({
      code: 'FRACCION_NO_VALIDA',
      detalles: { motivo: 'NO_MULTIPLO', fraccion: 14 },
    });
    const r = await dispensar('dev-empleado', {
      recetaId: id,
      cn: '570361',
      envases: [envFr],
      fraccion: { unidadesForma: 14 },
    });
    expect(r.status).toBe(201);
    const [d] = await E.h.db.select().from(dispensacion).where(eq(dispensacion.id, r.json.dispensaciones[0]));
    expect(d).toMatchObject({
      unidades: 0,
      unidadesForma: 14,
      unidadesTexto: '14 comprimidos (fracción de caja 28 comprimidos)',
    });
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.estado).toBe('DISPENSADA');
  });

  it('sin unidades prescritas en la receta, o presentación no fraccionable → no se fracciona', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => ({
      ...lineaBenazecare(null)(r),
      lineas: lineaBenazecare(null)(r).lineas.map((l) => ({ ...l, cantidadEnvases: 1 })),
    }));
    const r = await dispensar('dev-empleado', {
      recetaId: id,
      cn: '570361',
      envases: [envFr],
      fraccion: { unidadesForma: 14 },
    });
    expect(r.json.error).toMatchObject({
      code: 'FRACCION_NO_VALIDA',
      detalles: { motivo: 'SIN_UNIDADES_PRESCRITAS' },
    });
    const id2 = await crearReceta(E.app);
    await confirmar(E.app, id2, (x) => ({
      ...recetaCorrecta()(x),
      lineas: recetaCorrecta()(x).lineas.map((l) => ({ ...l, unidadesForma: 5 })),
    }));
    const r2 = await dispensar('dev-empleado', {
      recetaId: id2,
      envases: [envase()],
      fraccion: { unidadesForma: 5 },
    });
    expect(r2.json.error).toMatchObject({
      code: 'FRACCION_NO_VALIDA',
      detalles: { motivo: 'NO_FRACCIONABLE' },
    });
  });
});

describe('psicótropos (guía: identidad de quien retira)', () => {
  it('sin DNI/NIE válido de quien retira no se dispensa; con él, se guarda cifrado', async () => {
    E.stock.datos['570681'] = [{ lote: 'DOL-2704', caducidad: '2027-04-30', disponible: 2 }];
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => {
      const b = recetaCorrecta(`R-PS-${Math.random().toString(36).slice(2, 7)}`)(r);
      return {
        ...b,
        indicacion: 'Eutanasia',
        lineas: b.lineas.map((l) => ({ ...l, cn: '570681', nregistro: '737 ESP', cantidadEnvases: 1 })),
      };
    });
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('DISPENSAR');
    const env = {
      lote: 'DOL-2704',
      caducidad: '2027-04-30',
      unidades: 1,
      metodoCaptura: 'camara',
      cnEscaneado: '570681',
    };
    for (const dniRetira of [null, '12345678A']) {
      const r = await dispensar('dev-empleado', { recetaId: id, cn: '570681', envases: [env], dniRetira });
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe('DNI_RETIRA_OBLIGATORIO');
      expect(JSON.stringify(r.json)).not.toContain('12345678A');
    }
    const ok = await dispensar('dev-empleado', {
      recetaId: id,
      cn: '570681',
      envases: [env],
      dniRetira: '12345678z',
    });
    expect(ok.status).toBe(201);
    const [d] = await E.h.db
      .select()
      .from(dispensacion)
      .where(eq(dispensacion.id, ok.json.dispensaciones[0]));
    expect(d!.dniRetiraEnc).not.toContain('12345678');
    expect(E.deps.cipher.decrypt(d!.dniRetiraEnc)).toBe('12345678Z');
  });
});

describe('defectos de forma, corrección manual y forzado', () => {
  it('campo mal leído corregido a mano → reevaluación sin forzado y con traza extraído/corregido', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => ({
      ...recetaCorrecta()(r),
      veterinario: { ...r.veterinario!, numColegiado: null },
    }));
    const antes = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(antes.json.lineas[0].resultado).toMatchObject({
      decision: 'NO_CONFORME',
      evidencias: { forzable: true },
    });
    await confirmar(E.app, id, (r) => ({
      ...r,
      veterinario: { ...r.veterinario!, numColegiado: '28/0000' },
    }));
    const despues = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(despues.json.lineas[0].resultado.decision).toBe('DISPENSAR');
    const g = await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`);
    expect(g.json.correcciones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campo: 'veterinario.numColegiado',
          extraido: '28/0000',
          corregido: '28/0000',
          por: 'dev-empleado',
        }),
      ]),
    );
  });

  it('defecto de forma forzado → dispensación con forzado=true, motivo obligatorio y receta apartada (el garante la revisa fuera, en el reporte semanal)', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => ({
      ...recetaCorrecta()(r),
      veterinario: { ...r.veterinario!, numColegiado: null },
    }));
    const corto = await dispensar('dev-empleado', {
      recetaId: id,
      forzado: { codigos: ['VETERINARIO_COLEGIADO_FALTA'], motivo: 'corto', aceptaRiesgos: true },
    });
    expect(corto.json.error.code).toBe('FORZADO_MOTIVO_CORTO');
    const sinAceptar = await dispensar('dev-empleado', {
      recetaId: id,
      forzado: {
        codigos: ['VETERINARIO_COLEGIADO_FALTA'],
        motivo: 'El veterinario lo confirma por teléfono',
        aceptaRiesgos: false,
      },
    });
    expect(sinAceptar.json.error.code).toBe('FORZADO_SIN_ACEPTACION');
    const ok = await dispensar('dev-empleado', {
      recetaId: id,
      forzado: {
        codigos: ['VETERINARIO_COLEGIADO_FALTA'],
        motivo: 'El veterinario lo confirma por teléfono',
        aceptaRiesgos: true,
      },
    });
    expect(ok.status).toBe(201);
    expect(ok.json.forzado).toEqual(['VETERINARIO_COLEGIADO_FALTA']);
    expect(ok.json.apartarReceta.motivo).toMatch(/defecto forzado/);
    const [d] = await E.h.db
      .select()
      .from(dispensacion)
      .where(eq(dispensacion.id, ok.json.dispensaciones[0]));
    expect(d).toMatchObject({
      forzado: true,
      defectosForzados: ['VETERINARIO_COLEGIADO_FALTA'],
      motivoForzado: 'El veterinario lo confirma por teléfono',
    });
    // Ya no hay bandeja del garante en la app.
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/garante/bandeja')).status).toBe(404);
  });

  it('envase caducado: forzable con PRODUCT_VALIDITY_HARD_BLOCK=false; rechazado con true', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, recetaCorrecta());
    const caducado = envase({ lote: 'CLV-2611', caducidad: '2026-10-01' });
    const sinForzar = await dispensar('dev-empleado', { recetaId: id, envases: [caducado] });
    expect(sinForzar.json.error).toMatchObject({
      code: 'DISPENSACION_BLOQUEADA',
      detalles: { forzables: ['ENVASE_CADUCADO'] },
    });
    const duro = await entorno({ config: { PRODUCT_VALIDITY_HARD_BLOCK: 'true' } });
    const rechazado = await api(duro.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: id,
      lineaOrden: 1,
      cn: '570016',
      envases: [caducado],
      forzado: {
        codigos: ['ENVASE_CADUCADO'],
        motivo: 'Forzado con bloqueo duro activado',
        aceptaRiesgos: true,
      },
    });
    expect(rechazado.json.error.code).toBe('DISPENSACION_BLOQUEADA');
    await duro.app.close();
    const forzado = await dispensar('dev-empleado', {
      recetaId: id,
      envases: [caducado],
      forzado: {
        codigos: ['ENVASE_CADUCADO'],
        motivo: 'Normalización de catálogo pendiente',
        aceptaRiesgos: true,
      },
    });
    expect(forzado.status).toBe(201);
    expect(forzado.json.forzado).toEqual(['ENVASE_CADUCADO']);
  });

  it('solo principio activo → NO_CONFORME forzable con opciones; elegir un no equivalente al forzar → rechazado', async () => {
    const id = await crearReceta(E.app, 'demo-solo-principio-activo');
    await confirmar(E.app, id, (r) => ({
      ...r,
      firmaConfirmada: true,
      comprobadoConOriginal: true,
      especie: { texto: 'Perro', especieId: 14 },
      veterinario: { ...r.veterinario!, numColegiado: '28/0001' },
      lineas: (r.lineas ?? []).map((l) => ({ ...l, cn: '570016', nregistro: '1868 ESP' })),
    }));
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    const l = ev.json.lineas[0];
    expect(l.resultado).toMatchObject({ decision: 'NO_CONFORME', evidencias: { forzable: true } });
    expect(l.opcionesSoloPA.map((o: { cn: string }) => o.cn)).toContain('570016');
    // La receta dice amoxicilina 250 mg: CLAVUBAY (amoxicilina + clavulánico) no es equivalente.
    const r = await dispensar('dev-empleado', {
      recetaId: id,
      forzado: {
        codigos: ['PRESCRIPCION_SOLO_PA'],
        motivo: 'El veterinario no contesta y es urgente',
        aceptaRiesgos: true,
      },
    });
    expect(r.json.error.code).toBe('FORZADO_ELECCION_NO_EQUIVALENTE');
  });
});

describe('PEDIR, PENDIENTE_STOCK y sustitución', () => {
  it('Siweb360 sin respuesta → PENDIENTE_STOCK; sin stock y sin equivalentes con stock → PEDIR y lista de pedido', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, recetaCorrecta());
    E.stock.noDisponible.add('570016');
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {})).json.lineas[0].resultado
        .decision,
    ).toBe('PENDIENTE_STOCK');
    E.stock.noDisponible.clear();
    const datos = E.stock.datos;
    E.stock.datos = {};
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('PEDIR');
    expect(
      ev.json.lineas[0].resultado.evidencias.pedido.equivalentes.map((e: { cn: string }) => e.cn),
    ).toContain('999901');
    const p = await api(E.app, 'dev-empleado', 'POST', '/api/pedidos', { cn: '570016', unidades: 1 });
    expect(p.status).toBe(201);
    E.stock.datos = datos;
  });

  it('sin stock del prescrito ni de otros formatos y equivalente con stock → SUSTITUIR → consentimiento → aviso → dispensar → apartar → firma del garante en papel registrada por el empleado', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, recetaCorrecta());
    const datos = E.stock.datos;
    E.stock.datos = { '999901': [{ lote: 'GEN-1', caducidad: '2027-09-30', disponible: 3 }] };
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.decision).toBe('SUSTITUIR');
    expect(ev.json.lineas[0].resultado.evidencias.sustitutos[0]).toMatchObject({
      cn: '999901',
      modo: 'POST',
    });
    const s = await api(E.app, 'dev-empleado', 'POST', '/api/sustituciones', {
      recetaId: id,
      lineaOrden: 1,
      cn: '999901',
    });
    expect(s.status).toBe(201);
    const sid = s.json.id;
    // Sin consentimiento ni aviso no se puede dispensar.
    const pronto = await api(E.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: id,
      lineaOrden: 1,
      cn: '999901',
      sustitucionId: sid,
      envases: [envase({ lote: 'GEN-1', caducidad: '2027-09-30', cnEscaneado: '999901' })],
    });
    expect(pronto.json.error.code).toBe('SUSTITUCION_REQUISITOS');
    await api(E.app, 'dev-empleado', 'POST', `/api/sustituciones/${sid}/consentimiento`, {
      consiente: true,
      medio: 'presencial',
    });
    const det = await api(E.app, 'dev-empleado', 'POST', `/api/sustituciones/${sid}/aviso-veterinario`, {
      medio: 'teléfono',
      resultado: 'conforme',
    });
    expect(det.json).toMatchObject({ estado: 'AVISO_VETERINARIO', puedeDispensar: true });
    expect(det.json.plantillaAvisoVeterinario).toMatch(/CN 999901/);
    const d = await api(E.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: true,
      recetaId: id,
      lineaOrden: 1,
      cn: '999901',
      sustitucionId: sid,
      envases: [envase({ lote: 'GEN-1', caducidad: '2027-09-30', cnEscaneado: '999901' })],
    });
    expect(d.status).toBe(201);
    expect(d.json.apartarReceta.motivo).toMatch(/firma del garante/);
    expect(d.json.apartarReceta.etiqueta).toMatch(/CN: 999901/);
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/sustituciones/${sid}/anotacion`, {})).json.estado,
    ).toBe('RECETA_APARTADA');
    expect(
      (
        await api(E.app, 'dev-admin', 'POST', `/api/sustituciones/${sid}/firma-garante`, {
          garante: 'Ana Garante',
        })
      ).status,
    ).toBe(403);
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/sustituciones/${sid}/firma-garante`, {})).json.error
        .code,
    ).toBe('SUSTITUCION_REQUISITOS'); // sin nombre
    const firmada = await api(E.app, 'dev-empleado', 'POST', `/api/sustituciones/${sid}/firma-garante`, {
      garante: 'Ana Garante',
    });
    expect(firmada.json.estado).toBe('FIRMADA_GARANTE');
    expect(firmada.json.autorizacion.firma).toMatchObject({
      garante: 'Ana Garante',
      empleado: 'dev-empleado',
    });
    // Pendientes: ya no figura (firma registrada).
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.sustituciones.map(
        (x: { id: string }) => x.id,
      ),
    ).not.toContain(sid);
    const [row] = await E.h.db
      .select()
      .from(dispensacion)
      .where(eq(dispensacion.id, d.json.dispensaciones[0]));
    expect(row).toMatchObject({
      esSustitucion: true,
      cnPrescrito: '570016',
      sustitucionId: sid,
      procedimientoVersion: 'SUSTITUCION@0-dev',
    });
    E.stock.datos = datos;
  });

  it('sin stock del envase de 10 pero sí del de 20 → el de 20 se descarta por CANTIDAD_SUPERIOR', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, recetaCorrecta());
    const datos = E.stock.datos;
    E.stock.datos = { '570017': [{ lote: 'X20', disponible: 1 }] };
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect(ev.json.lineas[0].resultado.evidencias.alternativasDescartadas).toEqual(
      expect.arrayContaining([expect.objectContaining({ cn: '570017', motivos: ['CANTIDAD_SUPERIOR'] })]),
    );
    E.stock.datos = datos;
  });
});

describe('venta sin receta y pedidos online (SPEC §4.7)', () => {
  const sinReceta = (body: Record<string, unknown>) =>
    api(E.app, 'dev-empleado', 'POST', '/api/dispensaciones', {
      conReceta: false,
      canal: 'online',
      cn: '570025',
      envases: [envase({ lote: 'ADQ-1', caducidad: '2027-03-31', cnEscaneado: '570025' })],
      ...body,
    });

  it('pedido online con medicamento sujeto a receta → bloqueo, incluso si se intenta forzar', async () => {
    const r = await sinReceta({
      cn: '570016',
      envases: [envase()],
      propietario: { nombre: 'C', movil: '600', direccion: 'Calle', dni: '12345678Z' },
      forzado: {
        codigos: ['ONLINE_CON_RECETA'],
        motivo: 'Lo intento forzar igualmente',
        aceptaRiesgos: true,
      },
    });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({
      code: 'DISPENSACION_BLOQUEADA',
      detalles: { codigos: ['ONLINE_CON_RECETA'] },
    });
  });

  it('online sin DNI o con letra de control incorrecta → no se puede confirmar', async () => {
    expect(
      (await sinReceta({ propietario: { nombre: 'C', movil: '600', direccion: 'Calle', dni: null } })).json
        .error.code,
    ).toBe('DATOS_PROPIETARIO_ONLINE');
    expect(
      (await sinReceta({ propietario: { nombre: 'C', movil: '600', direccion: 'Calle', dni: '12345678A' } }))
        .json.error.code,
    ).toBe('DNI_INVALIDO');
  });

  it('online correcto: DNI cifrado en BD; exportación C sin datos por defecto y DNI enmascarado salvo administración con MFA (auditado)', async () => {
    const r = await sinReceta({
      propietario: { nombre: 'Cliente Online', movil: '600111222', direccion: 'Calle 1', dni: '12345678Z' },
      referenciaPedido: 'WEB-1',
      especie: 'Perro',
    });
    expect(r.status).toBe(201);
    const [d] = await E.h.db.select().from(dispensacion).where(eq(dispensacion.id, r.json.dispensaciones[0]));
    const [p] = await E.h.db.select().from(propietario).where(eq(propietario.id, d!.propietarioId!));
    expect(p!.dniEnc).not.toContain('12345678Z');
    const q = '/api/registros/salidas?desde=2026-10-14&hasta=2026-10-14&plantilla=C';
    const sinDatos = await api(E.app, 'dev-empleado', 'GET', q);
    expect(sinDatos.json.tablas[0].filas[0].slice(9, 13)).toEqual(['', '', '', '']);
    const empleado = await api(E.app, 'dev-empleado', 'GET', `${q}&incluirPropietario=1`);
    expect(empleado.json.tablas[0].filas[0].slice(9, 13)).toEqual([
      'Cliente Online',
      '600111222',
      '****5678Z',
      'Calle 1',
    ]);
    expect((await api(E.app, 'dev-empleado', 'GET', `${q}&incluirPropietario=1&dniCompleto=1`)).status).toBe(
      403,
    );
    expect((await api(E.app, 'dev-admin', 'GET', `${q}&incluirPropietario=1&dniCompleto=1`)).status).toBe(
      403,
    ); // sin MFA
    const admin = await api(E.app, 'dev-admin', 'GET', `${q}&incluirPropietario=1&dniCompleto=1`, undefined, {
      mfa: true,
    });
    expect(admin.json.tablas[0].filas[0][11]).toBe('12345678Z');
    const aud = await E.h.db.select().from(auditEvent).where(eq(auditEvent.accion, 'exportar_dni_completo'));
    expect(aud).toHaveLength(1);
  });

  it('presencial con medicamento sujeto a receta → redirección al flujo de receta', async () => {
    const r = await api(E.app, 'dev-empleado', 'GET', '/api/venta/comprobar?cn=570016&canal=presencial');
    expect(r.json).toMatchObject({ permitido: false });
    expect(r.json.incidencias[0].code).toBe('RECETA_REQUERIDA');
  });
});

describe('registros, exportaciones y anulación', () => {
  it('exporta A en XLSX y CSV; la anulación la registra el empleado con motivo y no se repite', async () => {
    const xlsx = await api(
      E.app,
      'dev-empleado',
      'GET',
      '/api/registros/salidas?desde=2026-10-14&hasta=2026-10-14&plantilla=A&formato=xlsx',
    );
    expect(xlsx.res.headers['content-type']).toContain('spreadsheetml');
    const csv = await api(
      E.app,
      'dev-empleado',
      'GET',
      '/api/registros/salidas?desde=2026-10-14&hasta=2026-10-14&plantilla=A&formato=csv',
    );
    expect(
      csv.res.body.startsWith('﻿NOMBRE DEL FÁRMACO;PRINCIPIO ACTIVO;FORMA FARMACÉUTICA;ESPECIE;FECHA VENTA'),
    ).toBe(true);
    const [d] = await E.h.db.select().from(dispensacion).limit(1);
    expect(
      (
        await api(E.app, 'dev-admin', 'POST', `/api/dispensaciones/${d!.id}/anular`, {
          motivo: 'Error de captura del lote',
        })
      ).status,
    ).toBe(403);
    const ok = await api(E.app, 'dev-empleado', 'POST', `/api/dispensaciones/${d!.id}/anular`, {
      motivo: 'Error de captura del lote',
    });
    expect(ok.status).toBe(200);
    const dup = await api(E.app, 'dev-empleado', 'POST', `/api/dispensaciones/${d!.id}/anular`, {
      motivo: 'Error de captura del lote',
    });
    expect(dup.json.error.code).toBe('ANULACION_DUPLICADA');
    const json = await api(
      E.app,
      'dev-empleado',
      'GET',
      '/api/registros/salidas?desde=2026-10-14&hasta=2026-10-14&plantilla=A',
    );
    const fila = json.json.tablas[0].filas.find((f: string[]) => f[15] === d!.id);
    expect(fila.at(-1)).toBe('S');
  });

  it('reporte semanal bajo demanda y listado de reportes', async () => {
    const r = await api(E.app, 'dev-empleado', 'POST', '/api/reportes/semanal/generar', {
      desde: '2026-10-01',
      hasta: '2026-10-14',
    });
    expect(r.res.headers['content-type']).toContain('spreadsheetml');
    const l = await api(E.app, 'dev-veterinaria', 'GET', '/api/reportes');
    expect(l.json[0]).toMatchObject({ tipo: 'semanal', periodo: '2026-10-01_2026-10-14' });
    expect(
      (await api(E.app, 'dev-admin', 'GET', `/api/reportes/${l.json[0].id}/descargar`)).res.headers[
        'content-type'
      ],
    ).toContain('spreadsheetml');
  });

  it('registro de psicótropos y de entradas', async () => {
    expect(
      (
        await api(
          E.app,
          'dev-veterinaria',
          'GET',
          '/api/registros/psicotropos?desde=2026-10-01&hasta=2026-10-31',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          E.app,
          'dev-veterinaria',
          'GET',
          '/api/registros/entradas?desde=2026-10-01&hasta=2026-10-31',
        )
      ).status,
    ).toBe(200);
  });
});

describe('recepción de mercancía (SPEC §4.9)', () => {
  it('autocompleta desde CIMAVet, suma escaneos del mismo lote, calcula el coste y bloquea la edición al finalizar', async () => {
    const dist = (await api(E.app, 'dev-empleado', 'GET', '/api/admin/distribuidores')).json[0];
    const r = await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
      distribuidorId: dist.id,
      albaran: 'ALB-1',
    });
    expect(r.status).toBe(201);
    const rid = r.json.id;
    const l1 = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
      cn: '570016',
      lote: 'E1',
      caducidad: '2027-12-31',
      unidades: 1,
      serie: 'S1',
      precioNetoCompra: '10.00',
      ivaPct: 10,
    });
    expect(l1.json.linea).toMatchObject({
      origenDatos: 'cimavet',
      principioActivoTxt: 'amoxicilina trihidrato 459 mg; clavulanato potasio 119 mg',
      formaTxt: 'COMPRIMIDO',
      precioCoste: '10.1400',
    });
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
          cn: '570016',
          lote: 'E1',
          caducidad: '2027-12-31',
          serie: 'S2',
        })
      ).json.linea.unidades,
    ).toBe(2);
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
          cn: '570016',
          lote: 'E1',
          caducidad: '2027-12-31',
          serie: 'S2',
        })
      ).json.duplicado,
    ).toBe(true);
    const mal = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
      cn: '570016',
      cnEscaneado: '570017',
      lote: 'E2',
      caducidad: '2027-12-31',
    });
    expect(mal.status).toBe(400);
    await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
      cn: '570016',
      lote: 'E3',
      caducidad: '2026-12-01',
    });
    const det = await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${rid}`);
    expect(det.json.lineas.find((l: { lote: string }) => l.lote === 'E3').avisos[0].code).toBe(
      'CADUCIDAD_PROXIMA_ENTRADA',
    );
    await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
      tipo: 'producto',
      nombre: 'Collar antiparasitario',
      unidades: 2,
    });
    const fin = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/finalizar`);
    expect(fin.json).toMatchObject({ escrituraDesactivada: true });
    // El registro de entradas solo lleva medicamentos: el collar (otro producto) no aparece.
    const reg = (
      await api(E.app, 'dev-empleado', 'GET', '/api/registros/entradas?desde=2026-10-01&hasta=2026-10-31')
    ).json.tablas[0];
    expect(JSON.stringify(reg.filas)).not.toContain('Collar antiparasitario');
    expect(JSON.stringify(reg.filas)).toContain('E1');
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
          cn: '570016',
          lote: 'X',
        })
      ).json.error.code,
    ).toBe('RECEPCION_NO_EDITABLE');
  });

  it('no finaliza con datos obligatorios incompletos', async () => {
    const dist = (await api(E.app, 'dev-empleado', 'GET', '/api/admin/distribuidores')).json[0];
    const rid = (await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', { distribuidorId: dist.id }))
      .json.id;
    await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/lineas`, {
      cn: '570016',
      lote: null,
      caducidad: null,
    });
    const fin = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${rid}/finalizar`);
    expect(fin.json.error).toMatchObject({
      code: 'RECEPCION_INCOMPLETA',
      detalles: { lineas: [{ numero: 1, faltan: ['caducidad', 'lote'] }] },
    });
  });
});

describe('medicamentos, FEFO y escaneo', () => {
  it('búsqueda, detalle, FEFO y parseo GS1 con heurística de CN', async () => {
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/buscar?q=clavubay')).json[0].cn).toBe(
      '570016',
    );
    // La especie no filtra (cascada): CLAVUBAY es solo para perros y aparece para un gato, marcado.
    const gato = (await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/buscar?q=clavubay&especie=15'))
      .json;
    expect(gato[0]).toMatchObject({ cn: '570016', autorizadoEspecie: false });
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/buscar?q=clavubay&especie=14')).json[0]
        .autorizadoEspecie,
    ).toBe(true);
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/1868%20ESP')).json.especies).toEqual([
      'Perros',
    ]);
    const f = await api(E.app, 'dev-empleado', 'GET', '/api/stock/570016/fefo?unidades=3&duracionDias=60');
    expect(f.json.propuesta.recomendado.lote).toBe('CLV-2611');
    expect(f.json.propuesta.avisos.map((a: { code: string }) => a.code)).toContain(
      'LOTE_CADUCA_ANTES_FIN_TRATAMIENTO',
    );
    const s = await api(E.app, 'dev-empleado', 'POST', '/api/scan/parse', {
      raw: '010847000570016817271130' + '10LOTE1',
    });
    expect(s.json).toMatchObject({ ok: true, cn: '570016', cnEnCimavet: true, caducidad: '2027-11-30' });
    expect(
      (
        await api(
          E.app,
          'dev-empleado',
          'GET',
          '/api/medicamentos/1868%20ESP/equivalentes?especie=14&indicacion=Infecci%C3%B3n%20cut%C3%A1nea',
        )
      ).status,
    ).toBe(200);
  });

  it('Inicio muestra contadores', async () => {
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/inicio')).json).toHaveProperty(
      'sustitucionesPendientes',
    );
  });
});

describe('administración', () => {
  it('reglas activas y registro de su aprobación por administración con MFA; plataformas verificables', async () => {
    const r = await api(E.app, 'dev-admin', 'GET', '/api/admin/reglas');
    expect(r.json.ficheros).toHaveLength(5);
    expect(
      (await api(E.app, 'dev-admin', 'POST', `/api/admin/reglas/${r.json.ficheros[0].id}/aprobar`)).status,
    ).toBe(403); // sin MFA
    expect(
      (
        await api(
          E.app,
          'dev-empleado',
          'POST',
          `/api/admin/reglas/${r.json.ficheros[0].id}/aprobar`,
          undefined,
          { mfa: true },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          E.app,
          'dev-admin',
          'POST',
          `/api/admin/reglas/${r.json.ficheros[0].id}/aprobar`,
          undefined,
          { mfa: true },
        )
      ).json.aprobadaPor,
    ).toBe('dev-admin');
    const p = await api(E.app, 'dev-admin', 'PUT', '/api/admin/plataformas/recevet', {
      reconocidaMapa: true,
      urlVerificacion: null,
    });
    expect(p.json.reconocidaMapa).toBe(true);
    expect((await api(E.app, 'dev-admin', 'GET', '/api/admin/outbox')).json.error.code).toBe(
      'SIWEB_NO_DISPONIBLE',
    );
    expect(
      (
        await api(E.app, 'dev-admin', 'POST', '/api/admin/exclusiones', {
          nregistro: '1077 ESP',
          motivo: 'Prueba',
          fuente: 'Test',
        })
      ).status,
    ).toBe(201);
  });
});

describe('pendientes de la operativa (el garante no usa la app)', () => {
  it('lista discrepancias abiertas y el empleado las resuelve con una nota auditada', async () => {
    const [x] = await E.h.db
      .insert(discrepancia)
      .values({
        tipo: 'DISPENSACION_SIN_TICKET',
        origen: 'sales-reconciliation',
        fecha: new Date('2026-10-14T19:00:00Z'),
        datos: { cn: '570016' },
      })
      .returning();
    const p = await api(E.app, 'dev-empleado', 'GET', '/api/pendientes');
    expect(p.json.discrepancias.map((d: { id: string }) => d.id)).toContain(x!.id);
    expect((await api(E.app, 'dev-admin', 'GET', '/api/pendientes')).status).toBe(403);
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/discrepancias/${x!.id}/resolver`, { nota: 'corto' }))
        .status,
    ).toBe(400);
    const r = await api(E.app, 'dev-empleado', 'POST', `/api/discrepancias/${x!.id}/resolver`, {
      nota: 'Ticket cobrado al día siguiente (T-2026-000150)',
    });
    expect(r.json).toMatchObject({
      estado: 'resuelta',
      resueltaPor: 'dev-empleado',
      notaResolucion: 'Ticket cobrado al día siguiente (T-2026-000150)',
    });
    expect((await api(E.app, 'dev-empleado', 'GET', '/api/inicio')).json.discrepanciasAbiertas).toBe(0);
  });
});

describe('revisión: datos de CIMAVet y validez en el formulario', () => {
  it('resumen de la presentación: nombre, forma, principios activos y concentración', async () => {
    const r = await api(
      E.app,
      'dev-empleado',
      'GET',
      '/api/medicamentos/presentaciones/570016/resumen?especie=14',
    );
    expect(r.json).toMatchObject({
      cn: '570016',
      nregistro: '1868 ESP',
      presentacion:
        'CLAVUBAY 400 mg / 100 mg COMPRIMIDOS SABOR PARA PERROS, Caja de cartón con 2 Blisters con 5 Comprimidos (10 comprimidos)',
      forma: 'COMPRIMIDO',
      principiosActivos: 'amoxicilina trihidrato + clavulanato potasio',
      // La del nombre autorizado, no la de la sal de la composición (459 mg + 119 mg).
      concentracion: '400 mg / 100 mg',
      autorizadoEspecie: true,
    });
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/presentaciones/570016/resumen?especie=15'))
        .json.autorizadoEspecie,
    ).toBe(false);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/medicamentos/presentaciones/999999/resumen')).status,
    ).toBe(404);
  });

  it('el borrador toma forma, principios activos y concentración de CIMAVet', async () => {
    const id = await crearReceta(E.app);
    const l = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion.lineas[0];
    expect(l).toMatchObject({
      cn: '570016',
      formaTexto: 'COMPRIMIDO',
      principioActivoTexto: 'amoxicilina trihidrato + clavulanato potasio',
      concentracionTexto: '400 mg / 100 mg',
    });
  });

  it('validez: caducada se avisa con los datos del formulario, sin guardarlos', async () => {
    const id = await crearReceta(E.app);
    const base = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion;
    const vieja = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/validez`, {
      ...base,
      fechaEmision: '2020-01-01',
    });
    // CLAVUBAY es antibiótico: 5 días.
    expect(vieja.json.validez).toMatchObject({
      caducada: true,
      validaHasta: '2020-01-06',
      plazoMaximo: '5 días',
    });
    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/validez`, base)).json.validez,
    ).toMatchObject({ caducada: false });
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/validez`, {
          ...base,
          fechaEmision: null,
        })
      ).json.validez,
    ).toBeNull();
  });
});

describe('distribuidor en texto libre, titular con DNI y dirección, informes de conjunto', () => {
  it('el distribuidor escrito a mano se reutiliza si ya existe (sin distinguir mayúsculas ni tildes) o se da de alta', async () => {
    const a = await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
      distribuidor: 'Distribuciones Veterinarias Núñez',
      albaran: 'ALB-T1',
    });
    expect(a.status).toBe(201);
    const b = await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
      distribuidor: '  distribuciones veterinarias nunez ',
    });
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${b.json.id}`)).json.distribuidor).toBe(
      'Distribuciones Veterinarias Núñez',
    );
    const lista = (await api(E.app, 'dev-empleado', 'GET', '/api/admin/distribuidores')).json as {
      nombre: string;
    }[];
    expect(lista.filter((x) => x.nombre === 'Distribuciones Veterinarias Núñez')).toHaveLength(1);
    expect((await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', { albaran: 'X' })).status).toBe(400);
  });

  it('dirección y DNI del titular: opcionales, cifrados y en el registro de salidas si se pide', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => ({
      ...recetaCorrecta()(r),
      titular: {
        nombre: 'Titular Prueba',
        telefono: '600000000',
        direccion: 'Calle Falsa 123',
        dni: '12345678Z',
      },
    }));
    const [row] = await E.h.db.select().from(receta).where(eq(receta.id, id));
    expect(JSON.stringify(row!.confirmacion)).not.toContain('Calle Falsa');
    expect(JSON.stringify(row!.confirmacion)).not.toContain('12345678Z');
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion.titular,
    ).toMatchObject({ direccion: 'Calle Falsa 123', dni: '12345678Z' });
    await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    expect((await dispensar('dev-empleado', { recetaId: id })).status).toBe(201);
    const t = (
      await api(
        E.app,
        'dev-empleado',
        'GET',
        '/api/registros/salidas?desde=2020-01-01&hasta=2030-12-31&incluirPropietario=1',
      )
    ).json.tablas[0];
    const fila = t.filas.find((f: string[]) => f.includes('Calle Falsa 123'));
    expect(fila).toBeTruthy();
    // DNI enmascarado salvo administración con MFA.
    expect(fila.join('|')).not.toContain('12345678Z');
  });

  it('dispensación ágil: se dispensa con lo esencial y el registro se completa después (Pendientes)', async () => {
    const id = await crearReceta(E.app);
    await confirmar(E.app, id, (r) => ({
      ...recetaCorrecta()(r),
      registroDiferido: true,
      titular: { nombre: null, telefono: null, direccion: null, dni: null },
      indicacion: null,
      veterinario: { ...r.veterinario, nombre: null },
    }));
    const ev = await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
    const motivos = ev.json.lineas[0].resultado.motivos.map((m: { code: string }) => m.code);
    expect(motivos).toContain('REGISTRO_PENDIENTE');
    expect(motivos).not.toContain('TITULAR_NOMBRE_FALTA');
    expect((await dispensar('dev-empleado', { recetaId: id })).status).toBe(201);
    const pend = (await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.registros as {
      id: string;
    }[];
    expect(pend.map((x) => x.id)).toContain(id);

    const base = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion;
    const colegiado = base.veterinario.numColegiado;
    const r = await api(E.app, 'dev-empleado', 'PUT', `/api/recetas/${id}/registro`, {
      ...base,
      titular: { ...base.titular, nombre: 'Titular Ágil' },
      indicacion: 'Otitis externa',
      veterinario: { ...base.veterinario, nombre: 'Vet Ágil', numColegiado: '99/9999' },
      numero: 'CAMBIADO',
    });
    expect(r.status).toBe(200);
    const despues = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion;
    expect(despues).toMatchObject({
      indicacion: 'Otitis externa',
      titular: { nombre: 'Titular Ágil' },
      veterinario: { nombre: 'Vet Ágil', numColegiado: colegiado },
    });
    // Lo comprobado antes de dispensar no cambia.
    expect(despues.numero).toBe(base.numero);
    expect(
      ((await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.registros as { id: string }[]).map(
        (x) => x.id,
      ),
    ).not.toContain(id);
    const sal = (
      await api(
        E.app,
        'dev-empleado',
        'GET',
        '/api/registros/salidas?desde=2020-01-01&hasta=2030-12-31&incluirPropietario=1',
      )
    ).json.tablas[0];
    expect(sal.filas.some((f: string[]) => f.includes('Titular Ágil') && f.includes('Vet Ágil'))).toBe(true);
  });

  it('conciliación con el ticket: pendiente sin ticket, conciliada al cobrar, discrepancia si no cuadran las unidades; sin duplicados', async () => {
    const completar = async (id: string) => {
      const base = (await api(E.app, 'dev-empleado', 'GET', `/api/recetas/${id}`)).json.confirmacion;
      return (
        await api(E.app, 'dev-empleado', 'PUT', `/api/recetas/${id}/registro`, {
          ...base,
          titular: { ...base.titular, nombre: 'Titular TPV' },
        })
      ).json;
    };
    const nueva = async () => {
      const id = await crearReceta(E.app);
      await confirmar(E.app, id, (r) => ({ ...recetaCorrecta()(r), registroDiferido: true }));
      await api(E.app, 'dev-empleado', 'POST', `/api/recetas/${id}/evaluar`, {});
      expect((await dispensar('dev-empleado', { recetaId: id })).status).toBe(201);
      return id;
    };
    // Sin ticket: pendiente (durante el día no es discrepancia).
    const a = await nueva();
    expect((await completar(a)).conciliacion.salidas).toEqual([
      expect.objectContaining({ estado: 'pendiente' }),
    ]);
    const pendientesAntes = (await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.sinConciliar
      .salidas.length;
    expect(pendientesAntes).toBeGreaterThan(0);
    // Se cobra en el TPV (demo) → una salida de ese medicamento y unidades queda conciliada (el ticket no trae
    // lote ni receta: se empareja con una salida pendiente con el mismo código nacional y unidades).
    expect(
      (await api(E.app, 'dev-empleado', 'POST', '/api/demo/tpv', { cn: '570016', unidades: 1 })).status,
    ).toBe(201);
    const r1 = await api(E.app, 'dev-empleado', 'POST', '/api/conciliacion', {});
    expect(r1.json).toMatchObject({
      configurado: true,
      conciliadas: 1,
      loteSinVerificar: 1,
      discrepancias: 0,
    });
    expect(
      (await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.sinConciliar.salidas,
    ).toHaveLength(pendientesAntes - 1);
    // Repetir no duplica.
    expect((await api(E.app, 'dev-empleado', 'POST', '/api/conciliacion', {})).json.conciliadas).toBe(0);
    // Cobro con otras unidades → discrepancia al guardar el registro (no se repite al volver a conciliar).
    const b = await nueva();
    await api(E.app, 'dev-empleado', 'POST', '/api/demo/tpv', { cn: '570016', unidades: 3 });
    await completar(b);
    const disc = () =>
      api(E.app, 'dev-empleado', 'GET', '/api/pendientes').then(
        (x) => x.json.discrepancias.filter((d: { tipo: string }) => d.tipo === 'UNIDADES_DISTINTAS').length,
      );
    expect(await disc()).toBe(1);
    await api(E.app, 'dev-empleado', 'POST', '/api/conciliacion', {});
    expect(await disc()).toBe(1);
    // Al cierre, lo que queda sin ticket pasa a discrepancia.
    const cierre = await api(E.app, 'dev-empleado', 'POST', '/api/conciliacion', { cierre: true });
    expect(cierre.json.discrepancias).toBeGreaterThan(0);
    // Solo quedan las fracciones, que no se venden como envase en el TPV y se revisan a mano.
    const quedan = (await api(E.app, 'dev-empleado', 'GET', '/api/pendientes')).json.sinConciliar.salidas as {
      fraccion: boolean;
    }[];
    expect(quedan.every((x) => x.fraccion)).toBe(true);
    // Informe: estado del registro y de la conciliación de cada salida.
    const t = (
      await api(
        E.app,
        'dev-empleado',
        'GET',
        '/api/registros/todas-salidas?desde=2020-01-01&hasta=2030-12-31',
      )
    ).json.tablas[0];
    expect(t.columnas.slice(-2)).toEqual(['REGISTRO', 'CONCILIACIÓN CON TICKET']);
    expect(t.filas.map((f: string[]) => f.at(-1))).toEqual(
      expect.arrayContaining(['conciliada', 'discrepancia']),
    );
  });

  it('informes: todas las salidas juntas y entradas + salidas por fecha', async () => {
    const q = 'desde=2020-01-01&hasta=2030-12-31';
    const todas = (await api(E.app, 'dev-empleado', 'GET', `/api/registros/todas-salidas?${q}`)).json
      .tablas[0];
    expect(todas.columnas[1]).toBe('TIPO DE SALIDA');
    expect(new Set(todas.filas.map((f: string[]) => f[1]))).toContain('Con receta');
    // Sin pedirlo, sin datos del propietario; marcándolo, al final y con el DNI enmascarado.
    expect(todas.columnas).not.toContain('NOMBRE PROPIETARIO');
    const conProp = (
      await api(E.app, 'dev-empleado', 'GET', `/api/registros/todas-salidas?${q}&incluirPropietario=1`)
    ).json.tablas[0];
    expect(conProp.columnas.slice(-4)).toEqual(['NOMBRE PROPIETARIO', 'MÓVIL', 'DNI', 'DIRECCIÓN']);
    expect(conProp.filas.some((f: string[]) => f.at(-4))).toBe(true);
    expect(conProp.filas.every((f: string[]) => !f.at(-2) || /\*/.test(f.at(-2)!))).toBe(true);
    const mov = (await api(E.app, 'dev-empleado', 'GET', `/api/registros/movimientos?${q}`)).json.tablas[0];
    const tipos = mov.filas.map((f: string[]) => f[1]);
    expect(tipos).toContain('Entrada');
    expect(tipos.some((t: string) => t.startsWith('Salida'))).toBe(true);
    const x = await api(E.app, 'dev-empleado', 'GET', `/api/registros/movimientos?${q}&formato=xlsx`);
    expect(x.res.headers['content-type']).toContain('spreadsheetml');
    // Un documento, dos hojas: entradas y salidas por separado.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.res.rawPayload as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Entradas', 'Todas las salidas']);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/registros/movimientos?${q}&formato=csv`)).status,
    ).toBe(400);
  });
});

describe('recepción: validación previa, edición de líneas, fecha de recepción y lectura del albarán', () => {
  const nueva = async () =>
    (
      await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
        distribuidor: 'Distribuidora Veterinaria de Prueba S.L.',
        fechaCompra: '2026-10-12',
        fechaRecepcion: '2026-10-13',
      })
    ).json.id as string;

  it('guarda la fecha de recepción y propone los distribuidores conocidos', async () => {
    const id = await nueva();
    expect((await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${id}`)).json).toMatchObject({
      fechaCompra: '2026-10-12',
      fechaRecepcion: '2026-10-13',
    });
    const p = (await api(E.app, 'dev-empleado', 'GET', '/api/recepciones/proveedores')).json;
    // Sin Siweb360 en los tests: solo los de la app.
    expect(p.siwebDisponible).toBe(false);
    expect(p.proveedores.map((x: { nombre: string }) => x.nombre)).toContain(
      'Distribuidora Veterinaria de Prueba S.L.',
    );
  });

  it('no deja añadir un producto caducado; explica qué campo falla; precio con coma; medicamento no encontrado', async () => {
    const id = await nueva();
    const caducado = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/lineas`, {
      cn: '570016',
      lote: 'C1',
      caducidad: '2026-01-31',
    });
    expect(caducado.status).toBe(422);
    expect(caducado.json.error).toMatchObject({ code: 'ENTRADA_CADUCADA', detalles: { campo: 'caducidad' } });
    expect(caducado.json.error.mensaje).toMatch(/El lote C1 caducó el 31\/01\/2026/);
    const mal = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/lineas`, {
      cn: '570016',
      unidades: 0,
      precioNetoCompra: '12;5',
    });
    expect(mal.status).toBe(400);
    const campos = (mal.json.error.detalles as { campo: string; mensaje: string }[]).map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['/unidades', '/precioNetoCompra']));
    expect(JSON.stringify(mal.json.error.detalles)).toMatch(/importe como 12,50/);
    const coma = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/lineas`, {
      cn: '570016',
      lote: 'P1',
      caducidad: '2027-12-31',
      precioNetoCompra: '10,00',
      ivaPct: 10,
    });
    expect(coma.status).toBe(201);
    expect(coma.json.linea).toMatchObject({ precioNetoCompra: '10.0000', precioCoste: '10.1400' });
    const noEsta = await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/lineas`, {
      cn: '999999',
      lote: 'X',
    });
    expect(noEsta.json.error).toMatchObject({ code: 'MEDICAMENTO_NO_EN_SISTEMA', detalles: { campo: 'cn' } });
    expect(noEsta.json.error.mensaje).toMatch(
      /No se ha encontrado ningún medicamento con el código nacional 999999/,
    );
  });

  it('las líneas se modifican mientras la recepción está abierta (no a caducado; no tras finalizar)', async () => {
    const id = await nueva();
    const l = (
      await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/lineas`, {
        cn: '570016',
        lote: 'E1',
        caducidad: '2027-12-31',
      })
    ).json.linea;
    const ed = await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${id}/lineas/${l.id}`, {
      lote: 'E1-B',
      unidades: 4,
      precioNetoCompra: '5,5',
      ivaPct: 10,
    });
    expect(ed.status).toBe(200);
    expect(ed.json.linea).toMatchObject({
      lote: 'E1-B',
      unidades: 4,
      precioNetoCompra: '5.5000',
      nombreFarmaco: l.nombreFarmaco,
    });
    expect(
      (
        await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${id}/lineas/${l.id}`, {
          caducidad: '2026-02-01',
        })
      ).json.error.code,
    ).toBe('ENTRADA_CADUCADA');
    await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${id}/finalizar`);
    expect(
      (await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${id}/lineas/${l.id}`, { unidades: 1 })).json
        .error.code,
    ).toBe('RECEPCION_NO_EDITABLE');
  });

  it('lee el albarán: propone líneas con su medicamento de CIMAVet y completa el nº de albarán; no añade nada solo', async () => {
    const id = await nueva();
    const { readFileSync } = await import('node:fs');
    const pdf = readFileSync(resolve(__dirname, '../../../fixtures/albaranes/sintetico-1.pdf'));
    const b = `----mmx${Date.now()}`;
    const payload = Buffer.concat([
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="documento"; filename="albaran.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      pdf,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const r = await E.app.inject({
      method: 'POST',
      url: `/api/recepciones/${id}/documento`,
      headers: { 'content-type': `multipart/form-data; boundary=${b}`, 'x-dev-user': 'dev-empleado' },
      payload,
    });
    expect(r.statusCode).toBe(200);
    const lec = r.json();
    expect(lec).toMatchObject({
      proveedor: 'DISTRIBUIDORA VETERINARIA DE PRUEBA S.L.',
      numero: 'ALB-2026-00417',
      fecha: '2026-10-15',
    });
    // 570016 está en la muestra del Nomenclátor de los tests; 999999 no es un medicamento.
    expect(lec.lineas[1]).toMatchObject({
      cn: '570016',
      cantidad: 2,
      lote: 'CLV-2805',
      caducidad: '2028-05-31',
      candidato: { cn: '570016' },
    });
    expect(lec.lineas[2].candidato).toBeNull();
    const det = (await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${id}`)).json;
    expect(det).toMatchObject({ albaran: 'ALB-2026-00417', lineas: [] });
    expect(det.lectura.lineas).toHaveLength(3);
  });
});

describe('importación de entradas y salidas anteriores a la app', () => {
  const subir = async (
    url: string,
    campos: Record<string, string>,
    nombre: string,
    contenido: string,
    u = 'dev-veterinaria',
  ) => {
    const b = `----mmx${Math.random().toString(16).slice(2)}`;
    const partes = [
      ...Object.entries(campos).map(
        ([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
      `--${b}\r\nContent-Disposition: form-data; name="fichero"; filename="${nombre}"\r\nContent-Type: text/csv\r\n\r\n${contenido}\r\n`,
      `--${b}--\r\n`,
    ];
    const r = await E.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': `multipart/form-data; boundary=${b}`, 'x-dev-user': u },
      payload: Buffer.from(partes.join('')),
    });
    return { status: r.statusCode, json: r.json() };
  };
  const entradasCsv =
    'FECHA COMPRA;NOMBRE DEL FÁRMACO;CÓDIGO NACIONAL;LOTE;CADUCIDAD;UNIDADES;DISTRIBUIDOR;Nº ALBARÁN;PRECIO NETO COMPRA (sin IVA)\r\n03/02/2025;CLAVUBAY 400 MG/100 MG;570016;OLD-1;31/12/2026;4;Distribuidor Antiguo;A-9;11,20\r\n';
  const salidasCsv =
    'FECHA;TIPO DE SALIDA;NOMBRE DEL FÁRMACO;CÓDIGO NACIONAL;LOTE;UNIDADES DISPENSADAS;Nº RECETA;VETERINARIO;Nº COLEGIADO\r\n05/02/2025;Con receta;CLAVUBAY 400 MG/100 MG;570016;OLD-1;1 caja 30 comprimidos;R-OLD;Vet Antiguo;28/9\r\n';

  it('vista previa con errores por fila; solo veterinaria responsable o administración', async () => {
    expect(
      (
        await subir(
          '/api/importaciones/vista-previa',
          { tipo: 'entradas' },
          'e.csv',
          entradasCsv,
          'dev-empleado',
        )
      ).status,
    ).toBe(403);
    const mal = await subir(
      '/api/importaciones/vista-previa',
      { tipo: 'entradas' },
      'e.csv',
      entradasCsv.replace('03/02/2025', '31/02/2025'),
    );
    expect(mal.json).toMatchObject({
      validas: 0,
      totalErrores: 1,
      errores: [{ fila: 2, mensajes: ['Fecha de compra no válida (usa dd/mm/aaaa)'] }],
    });
    expect(
      (
        await subir(
          '/api/importaciones',
          { tipo: 'entradas' },
          'e.csv',
          entradasCsv.replace('03/02/2025', '31/02/2025'),
        )
      ).json.error.code,
    ).toBe('VALIDACION');
    const ok = await subir('/api/importaciones/vista-previa', { tipo: 'entradas' }, 'e.csv', entradasCsv);
    expect(ok.json).toMatchObject({
      validas: 1,
      totalErrores: 0,
      muestra: [{ cn: '570016', unidades: 4, precioNetoCompra: '11.20' }],
    });
    // Validación contra CIMAVet: el principio activo y la forma vacíos se completan con los de CIMAVet.
    expect(ok.json.muestra[0].principioActivo).toMatch(/amoxicilina/);
    expect(ok.json.muestra[0].forma).toBe('COMPRIMIDO');
  });

  it('guarda los datos de CIMAVet en lugar de los escritos a mano (nombre, principio activo y forma)', async () => {
    const cab =
      'FECHA;TIPO DE SALIDA;NOMBRE DEL FÁRMACO;PRINCIPIO ACTIVO;FORMA FARMACÉUTICA;CÓDIGO NACIONAL;LOTE;UNIDADES DISPENSADAS\r\n';
    const csv =
      cab +
      '05/02/2025;Con receta;clavubay 400;amoxi;comp;570016;OLD-1;1\r\n' +
      '06/02/2025;Sin receta presencial;Clavubay 400 mg comprimidos;amoxi;comp;;OLD-2;1\r\n';
    const v = (await subir('/api/importaciones/vista-previa', { tipo: 'salidas' }, 'manual.csv', csv)).json;
    expect(v).toMatchObject({ validas: 2, totalErrores: 0 });
    const [conCn, sinCn] = v.muestra;
    expect(conCn).toMatchObject({
      cn: '570016',
      forma: 'COMPRIMIDO',
      nombreFarmaco: expect.stringMatching(/^CLAVUBAY 400/),
    });
    expect(conCn.principioActivo).toMatch(/^amoxicilina trihidrato/);
    expect(sinCn).toMatchObject({
      cn: null,
      forma: 'COMPRIMIDO',
      nombreFarmaco: expect.stringMatching(/^CLAVUBAY/),
    });
    expect(sinCn.principioActivo).toMatch(/^amoxicilina trihidrato/);
  });

  it('valida contra CIMAVet: CN inexistente → error; sin CN y medicamento → aviso; no medicamento → se omite', async () => {
    const csv =
      entradasCsv +
      '04/02/2025;PRODUCTO INVENTADO;999990;L-2;31/12/2026;1;Distribuidor Antiguo;A-9;1,00\r\n' +
      '04/02/2025;CLAVUBAY 400 MG/100 MG COMPRIMIDOS;;L-3;31/12/2026;2;Distribuidor Antiguo;A-9;6,00\r\n' +
      '04/02/2025;COLLAR ANTIPARASITARIO PERRO GRANDE;;L-4;31/12/2026;1;Distribuidor Antiguo;A-9;9,90\r\n';
    const v = (await subir('/api/importaciones/vista-previa', { tipo: 'entradas' }, 'cimavet.csv', csv)).json;
    expect(v.errores).toEqual([
      { fila: 3, mensajes: ['El código nacional 999990 no está en CIMAVet: revísalo'] },
    ]);
    expect(v.avisos).toEqual([
      { fila: 4, mensajes: [expect.stringMatching(/^Sin código nacional: se identifica como CLAVUBAY/)] },
    ]);
    expect(v.omitidas).toEqual([{ fila: 5, nombre: 'COLLAR ANTIPARASITARIO PERRO GRANDE' }]);
    expect(v.validas).toBe(2);
  });

  it('importa, aparece en los registros como importado, no se repite el mismo fichero y se puede anular', async () => {
    const e = await subir('/api/importaciones', { tipo: 'entradas' }, 'entradas-2025.csv', entradasCsv);
    expect(e.status).toBe(201);
    expect(e.json.filas).toBe(1);
    expect(
      (await subir('/api/importaciones', { tipo: 'entradas' }, 'otra-vez.csv', entradasCsv)).json.error.code,
    ).toBe('CONFLICTO');
    const s = await subir('/api/importaciones', { tipo: 'salidas' }, 'salidas-2025.csv', salidasCsv);
    expect(s.status).toBe(201);

    const q = 'desde=2025-01-01&hasta=2025-12-31';
    const ent = (await api(E.app, 'dev-empleado', 'GET', `/api/registros/entradas?${q}`)).json.tablas[0];
    expect(ent.filas).toEqual([
      expect.arrayContaining([
        expect.stringMatching(/^CLAVUBAY 400/),
        '03/02/2025',
        'OLD-1',
        'Distribuidor Antiguo',
        'importado',
      ]),
    ]);
    const sal = (await api(E.app, 'dev-empleado', 'GET', `/api/registros/salidas?${q}&plantilla=A`)).json
      .tablas[0];
    expect(sal.filas).toEqual([
      expect.arrayContaining([
        expect.stringMatching(/^CLAVUBAY 400/),
        '05/02/2025',
        '1 caja 30 comprimidos',
        'R-OLD',
        'Vet Antiguo',
      ]),
    ]);
    const todas = (await api(E.app, 'dev-empleado', 'GET', `/api/registros/todas-salidas?${q}`)).json
      .tablas[0];
    expect(todas.filas[0].at(-1)).toBe('no aplica');

    const lista = (await api(E.app, 'dev-veterinaria', 'GET', '/api/importaciones')).json as {
      id: string;
      tipo: string;
    }[];
    const idEnt = lista.find((x) => x.tipo === 'entradas')!.id;
    expect(
      (await api(E.app, 'dev-veterinaria', 'POST', `/api/importaciones/${idEnt}/anular`, { motivo: 'corto' }))
        .status,
    ).toBe(400);
    expect(
      (
        await api(E.app, 'dev-veterinaria', 'POST', `/api/importaciones/${idEnt}/anular`, {
          motivo: 'Fichero de otra tienda, importado por error',
        })
      ).status,
    ).toBe(204);
    expect(
      (await api(E.app, 'dev-empleado', 'GET', `/api/registros/entradas?${q}`)).json.tablas[0].filas,
    ).toEqual([]);
    // Anulada, el mismo fichero se puede volver a importar.
    expect(
      (await subir('/api/importaciones', { tipo: 'entradas' }, 'entradas-2025.csv', entradasCsv)).status,
    ).toBe(201);
  });
});

describe('recepción desde el albarán: lectura, foto, duplicados', () => {
  const subirAlbaran = async (bytes: Buffer) => {
    const m = multipart({}, [{ nombre: 'albaran.pdf', mime: 'application/pdf', bytes }]);
    const r = await E.app.inject({
      method: 'POST',
      url: '/api/recepciones/albaranes',
      headers: { ...m.headers, 'x-dev-user': 'dev-empleado' },
      payload: m.payload,
    });
    return { status: r.statusCode, json: r.json() };
  };
  const pdf = Buffer.from('%PDF-1.4 albarán sintético de prueba');

  it('lee número, proveedor y líneas con lote y caducidad; avisa de duplicados y crea la recepción con su foto', async () => {
    // Un test anterior ya registró el albarán ALB-2026-00417 de «Distribuidora Veterinaria de Prueba S.L.».
    const l1 = await subirAlbaran(pdf);
    expect(l1.status).toBe(201);
    expect(l1.json.lectura).toMatchObject({
      numero: 'ALB-2026-00417',
      proveedor: 'DISTRIBUIDORA VETERINARIA DE PRUEBA S.L.',
    });
    expect(l1.json.lectura.lineas[0]).toMatchObject({ lote: 'AMD-2801', caducidad: '2028-01-31' });
    expect(l1.json).toMatchObject({
      distribuidorSugerido: 'Distribuidora Veterinaria de Prueba S.L.',
      mismoFichero: null,
    });
    expect(l1.json.duplicados).toEqual([expect.objectContaining({ albaran: 'ALB-2026-00417' })]);

    // Crearla exige confirmar que es otro albarán (el número se compara sin guiones ni mayúsculas).
    const cuerpo = {
      distribuidor: 'Distribuidora Veterinaria de Prueba S.L.',
      albaran: 'alb 2026 00417',
      fechaCompra: '2026-10-14',
      documentoId: l1.json.documentoId,
    };
    const dup = await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', cuerpo);
    expect(dup.status).toBe(409);
    expect(dup.json.error.detalles.duplicados[0].id).toBe(l1.json.duplicados[0].id);
    const r = await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
      ...cuerpo,
      confirmarDuplicado: true,
    });
    expect(r.status).toBe(201);

    const det = (await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${r.json.id}`)).json;
    expect(det.lectura.numero).toBe('ALB-2026-00417');
    expect(det.documento).toMatchObject({ pdf: true });
    const foto = await E.app.inject({
      method: 'GET',
      url: det.documento.url,
      headers: { 'x-dev-user': 'dev-empleado' },
    });
    expect(foto.headers['content-type']).toBe('application/pdf');
    expect(foto.rawPayload.equals(pdf)).toBe(true);

    // El mismo fichero otra vez: se avisa de que ya se registró en esa recepción.
    const l2 = await subirAlbaran(pdf);
    expect(l2.json.mismoFichero).toEqual({ recepcionId: r.json.id });
    expect(l2.json.duplicados).toHaveLength(2);
    // Un documento ya usado no se enlaza a otra recepción.
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
          distribuidor: 'Otro distribuidor',
          albaran: null,
          documentoId: l1.json.documentoId,
        })
      ).status,
    ).toBe(400);
  });
});

describe('recepción como factura de compra: descuento, régimen, casillas y descarte', () => {
  it('precio con descuento, IVA y recargo; totales; régimen solo IVA; descartar una recepción abierta', async () => {
    const r = (
      await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
        distribuidor: 'Distribuidor de facturas',
        albaran: 'F-100',
        fechaCompra: '2026-10-10',
      })
    ).json;
    expect(r.regimen ?? 'recargo_equivalencia').toBe('recargo_equivalencia');
    const l = (
      await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${r.id}/lineas`, {
        cn: '570016',
        lote: 'F1',
        caducidad: '2027-12-31',
        unidades: 1,
        precioBruto: '67.67',
        descuentoPct: 12.88,
        ivaPct: 10,
        actualizarStock: false,
      })
    ).json.linea;
    expect(l).toMatchObject({
      precioBruto: '67.6700',
      descuentoPct: '12.880',
      precioNetoCompra: '58.9541',
      rePct: '1.40',
      actualizarStock: false,
      actualizarPrecio: true,
    });
    let det = (await api(E.app, 'dev-empleado', 'GET', `/api/recepciones/${r.id}`)).json;
    expect(det.totales).toEqual({ base: '58.95', iva: '5.90', recargo: '0.83', total: '65.68' });

    // Régimen solo IVA: sin recargo (se recalculan las líneas).
    det = (
      await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${r.id}`, {
        regimen: 'nacional',
        albaran: 'F-100B',
      })
    ).json;
    expect(det).toMatchObject({ regimen: 'nacional', albaran: 'F-100B' });
    expect(det.lineas[0]).toMatchObject({ rePct: '0.00', precioCoste: '58.9541' });
    expect(det.totales.recargo).toBe('0.00');
    // La casilla de stock se puede cambiar en la línea.
    expect(
      (
        await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${r.id}/lineas/${l.id}`, {
          actualizarStock: true,
        })
      ).json.linea.actualizarStock,
    ).toBe(true);

    expect(
      (await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${r.id}/descartar`, { motivo: 'no' }))
        .status,
    ).toBe(400);
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', `/api/recepciones/${r.id}/descartar`, {
          motivo: 'Albarán duplicado, se registró en otra',
        })
      ).status,
    ).toBe(204);
    expect(
      ((await api(E.app, 'dev-empleado', 'GET', '/api/recepciones')).json as { id: string }[]).some(
        (x) => x.id === r.id,
      ),
    ).toBe(false);
    expect(
      (await api(E.app, 'dev-empleado', 'PUT', `/api/recepciones/${r.id}`, { albaran: 'X' })).json.error.code,
    ).toBe('RECEPCION_NO_EDITABLE');
    // Una descartada no cuenta como duplicado.
    expect(
      (
        await api(E.app, 'dev-empleado', 'POST', '/api/recepciones', {
          distribuidor: 'Distribuidor de facturas',
          albaran: 'F-100B',
        })
      ).status,
    ).toBe(201);
  });
});
