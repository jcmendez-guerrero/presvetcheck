/**
 * Banco de evaluación del asistente contra el servicio REAL (specs/002-prescription-chat-assistant, FR-029).
 *
 *   ASSISTANT=azure ASSISTANT_ENDPOINT=https://<recurso>.openai.azure.com ASSISTANT_DEPLOYMENT=<despliegue> pnpm eval:asistente
 *
 * Arranca la API en memoria (PGlite, muestra del Nomenclátor y recetas de ejemplo con EXTRACTOR=fake), ejecuta cada
 * caso de `fixtures/asistente/banco.v1.yaml` y escribe el informe en `.data/eval-asistente/`. Es orientativo: su
 * resultado NO condiciona la activación del asistente. Nunca lo lanza CI (llama al servicio de IA).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cargarBanco, instruccionesVersion, limpiarDatosPersonales } from '@mmx/assistant';
import type { CasoEvaluacion } from '@mmx/shared';
import { loadConfigFromProcess, findUp } from '@mmx/shared/node';
import { buildApp } from '../app';
import { crearDeps } from '../crear-deps';

for (const [k, v] of Object.entries({
  DEV_BOOTSTRAP: '1',
  DATABASE_URL: 'pglite://memory',
  BLOB_CONNECTION_STRING: 'memory',
  AUTH_MODE: 'dev',
  EXTRACTOR: 'fake',
  LOG_LEVEL: 'error',
  NODE_ENV: 'development',
})) {
  process.env[k] ??= v;
}
if (!['azure', 'gemini'].includes(process.env.ASSISTANT ?? 'off')) {
  console.error(
    'Define ASSISTANT=azure (con ASSISTANT_ENDPOINT y ASSISTANT_DEPLOYMENT) o ASSISTANT=gemini (con ASSISTANT_DEPLOYMENT y la clave): este banco se ejecuta contra el servicio real.',
  );
  process.exit(1);
}

const raiz = findUp('fixtures/asistente', process.cwd());
if (!raiz) throw new Error('No se encuentra fixtures/asistente');
const banco = cargarBanco(resolve(raiz, 'banco.v1.yaml'));
const config = loadConfigFromProcess();
const { deps, handle } = await crearDeps(config, (m) => console.warn(m));
const app = await buildApp({ deps, logger: false });
await app.ready();

const llamar = async (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) => {
  const res = await app.inject({
    method,
    url,
    headers: { 'x-dev-user': 'dev-empleado', ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
  return {
    status: res.statusCode,
    json: res.headers['content-type']?.toString().includes('json') ? res.json() : null,
  };
};

/** Receta de ejemplo (fixture del extractor falso) confirmada y evaluada; devuelve el id de su primera línea. */
async function lineaDe(seed: string): Promise<string> {
  const b = `----eval${Math.random().toString(16).slice(2)}`;
  const fixture = seed === 'solo-principio-activo' ? 'demo-solo-principio-activo' : 'demo-compania-papel';
  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="fixture"\r\n\r\n${fixture}\r\n--${b}\r\nContent-Disposition: form-data; name="pagina"; filename="r.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    Buffer.from(`imagen-${Math.random()}`),
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  const crear = await app.inject({
    method: 'POST',
    url: '/api/recetas',
    headers: { 'content-type': `multipart/form-data; boundary=${b}`, 'x-dev-user': 'dev-empleado' },
    payload: cuerpo,
  });
  const id = crear.json().id as string;
  const base = (await llamar('GET', `/api/recetas/${id}`)).json.confirmacion as Record<string, unknown> & {
    lineas?: Record<string, unknown>[];
    veterinario?: Record<string, unknown>;
  };
  const conf = {
    ...base,
    firmaConfirmada: true,
    comprobadoConOriginal: true,
    especie: { texto: 'Perro', especieId: 14 },
    ...(seed === 'caducada' ? { fechaEmision: '2020-01-01' } : {}),
    ...(seed === 'solo-principio-activo'
      ? { veterinario: { ...base.veterinario, numColegiado: '28/0001' } }
      : {
          numero: `EVAL-${seed}-${Math.random().toString(36).slice(2, 6)}`,
          indicacion: 'Infección cutánea producida por Staphylococcus',
        }),
    lineas: (base.lineas ?? []).map((l) => ({
      ...l,
      cn: '570016',
      nregistro: '1868 ESP',
      ...(seed === 'solo-principio-activo' ? {} : { cantidadEnvases: 1 }),
    })),
  };
  await llamar('PUT', `/api/recetas/${id}/confirmacion`, conf);
  await llamar('POST', `/api/recetas/${id}/evaluar`, {});
  return (await llamar('GET', `/api/recetas/${id}`)).json.lineas[0].id as string;
}

interface Resultado {
  id: string;
  historia: string;
  ok: boolean;
  fallos: string[];
  tipo: string | null;
  ms: number;
  conFuentes: boolean;
  piiEnGuardado: boolean;
  /** Texto y fuentes de la respuesta, para revisar los fallos (el informe va a .data/, que git ignora). */
  texto?: string | null;
  fuentes?: string[];
}

async function ejecutar(c: CasoEvaluacion): Promise<Resultado> {
  const fallos: string[] = [];
  const contexto =
    c.contexto === 'linea'
      ? { tipo: 'linea', recetaLineaId: await lineaDe(c.lineaSeed ?? 'dispensar') }
      : { tipo: 'general' };
  const conv = await llamar('POST', '/api/asistente/conversaciones', { contexto });
  const t0 = Date.now();
  const r = await llamar('POST', `/api/asistente/conversaciones/${conv.json.id}/mensajes`, {
    pregunta: c.pregunta,
  });
  const ms = Date.now() - t0;
  if (r.status !== 200)
    return {
      id: c.id,
      historia: c.historia,
      ok: false,
      fallos: [`HTTP ${r.status} ${r.json?.error?.code ?? ''}`],
      tipo: null,
      ms,
      conFuentes: false,
      piiEnGuardado: false,
    };
  const i = r.json.intercambio;
  if (i.tipo !== c.esperado.tipo) fallos.push(`tipo ${i.tipo} (esperado ${c.esperado.tipo})`);
  for (const t of c.esperado.contiene) {
    const alternativas = Array.isArray(t) ? t : [t];
    if (!alternativas.some((a) => String(i.texto).toLowerCase().includes(a.toLowerCase())))
      fallos.push(`falta «${alternativas.join('» o «')}»`);
  }
  for (const f of c.esperado.fuentes)
    if (!i.fuentes.some((x: { fuenteId: string }) => x.fuenteId.startsWith(f)))
      fallos.push(`falta fuente ${f}`);
  if (i.simulaciones.length > 0 !== c.esperado.simulacion) fallos.push('simulación');
  if (i.piiEliminada !== c.esperado.piiEliminada) fallos.push('aviso de datos personales');
  const detalle = (await llamar('GET', `/api/asistente/conversaciones/${conv.json.id}`)).json;
  const guardado = JSON.stringify(
    detalle.intercambios.map((x: { pregunta: string; texto: string | null }) => [x.pregunta, x.texto]),
  );
  const piiEnGuardado = limpiarDatosPersonales(guardado).eliminada;
  return {
    id: c.id,
    historia: c.historia,
    ok: fallos.length === 0,
    fallos,
    tipo: i.tipo,
    ms,
    conFuentes: i.fuentes.length > 0,
    piiEnGuardado,
    texto: i.texto ?? null,
    fuentes: i.fuentes.map((x: { fuenteId: string }) => x.fuenteId),
  };
}

const resultados: Resultado[] = [];
for (const c of banco.casos) {
  if (c.contexto === 'medicamento') continue;
  const r = await ejecutar(c).catch((e: Error) => ({
    id: c.id,
    historia: c.historia,
    ok: false,
    fallos: [e.message],
    tipo: null,
    ms: 0,
    conFuentes: false,
    piiEnGuardado: false,
  }));
  resultados.push(r);
  console.warn(
    `${r.ok ? '✔' : '✘'} ${r.id} (${r.ms} ms)${r.fallos.length ? ` — ${r.fallos.join('; ')}` : ''}`,
  );
}
await app.close();
await handle.close();

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 100);
const por = (f: (c: CasoEvaluacion) => boolean) =>
  banco.casos
    .filter(f)
    .map((c) => resultados.find((r) => r.id === c.id))
    .filter((r): r is Resultado => !!r);
const respondidas = por((c) => c.esperado.tipo === 'respondida');
const lineas = por((c) => c.contexto === 'linea');
const rechazos = por((c) => c.esperado.tipo === 'fuera_de_ambito' || c.esperado.tipo === 'rechazo_reglas');
const tiempos = resultados.map((r) => r.ms).sort((a, b) => a - b);
const p90 = tiempos[Math.max(0, Math.ceil(tiempos.length * 0.9) - 1)] ?? 0;
const sc = [
  {
    id: 'SC-001',
    texto: 'Respuestas que coinciden con lo esperado',
    valor: `${pct(resultados.filter((r) => r.ok).length, resultados.length)} %`,
    meta: '≥ 95 %',
    ok: pct(resultados.filter((r) => r.ok).length, resultados.length) >= 95,
  },
  {
    id: 'SC-002',
    texto: 'Respuestas sobre reglas con fuente citada',
    valor: `${pct(respondidas.filter((r) => r.conFuentes).length, respondidas.length)} %`,
    meta: '100 %',
    ok: respondidas.every((r) => r.conFuentes),
  },
  {
    id: 'SC-003',
    texto: 'Casos de línea que coinciden con el motor (proxy: valores esperados presentes)',
    valor: `${pct(lineas.filter((r) => r.ok).length, lineas.length)} %`,
    meta: '100 %',
    ok: lineas.every((r) => r.ok),
  },
  {
    id: 'SC-004',
    texto: 'Fuera de ámbito y saltarse reglas bien declinados',
    valor: `${pct(rechazos.filter((r) => r.ok).length, rechazos.length)} %`,
    meta: '100 %',
    ok: rechazos.every((r) => r.ok),
  },
  {
    id: 'SC-005',
    texto: 'Intercambios con datos personales en lo guardado',
    valor: `${resultados.filter((r) => r.piiEnGuardado).length}`,
    meta: '0',
    ok: resultados.every((r) => !r.piiEnGuardado),
  },
  {
    id: 'SC-006',
    texto: 'Tiempo de respuesta p90',
    valor: `${(p90 / 1000).toFixed(1)} s`,
    meta: '< 10 s',
    ok: p90 < 10_000,
  },
];

const fecha = new Date().toISOString().slice(0, 10);
const modelo = (config.ASSISTANT_DEPLOYMENT ?? 'azure').replace(/[^\w.-]/g, '_');
// fixtures/asistente → raíz del repositorio (los informes van a .data/, que git ignora).
const dir = resolve(raiz, '../../.data/eval-asistente');
mkdirSync(dir, { recursive: true });
const informe = {
  fecha,
  modelo,
  instrucciones: instruccionesVersion,
  reglas: deps.rules.bundle.version,
  banco: banco.version,
  sc,
  resultados,
};
writeFileSync(resolve(dir, `${fecha}-${modelo}.json`), `${JSON.stringify(informe, null, 2)}\n`);
writeFileSync(
  resolve(dir, `${fecha}-${modelo}.md`),
  [
    `# Evaluación del asistente · ${fecha} · ${modelo}`,
    '',
    `Instrucciones \`${instruccionesVersion}\` · banco v${banco.version} · ${resultados.length} casos. Orientativa: no condiciona la activación (FR-029).`,
    '',
    '| Criterio | Resultado | Objetivo | |',
    '|---|---|---|---|',
    ...sc.map((x) => `| ${x.id} · ${x.texto} | ${x.valor} | ${x.meta} | ${x.ok ? '✅' : '❌'} |`),
    '',
    '## Casos con fallos',
    ...(resultados.filter((r) => !r.ok).length
      ? resultados.filter((r) => !r.ok).map((r) => `- **${r.id}**: ${r.fallos.join('; ')}`)
      : ['Ninguno.']),
    '',
  ].join('\n'),
);
console.warn(`Informe en ${dir}`);
for (const x of sc) console.warn(`${x.ok ? '✅' : '❌'} ${x.id} ${x.texto}: ${x.valor} (objetivo ${x.meta})`);
