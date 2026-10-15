import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Copy, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { RecetaConfirmadaInput } from '@mmx/shared';
import { ApiError, get, post, put } from '../lib/api';
import { CN } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Etiqueta, Info, Mensaje, Tarjeta } from '../componentes/ui';
import { AYUDA } from '../lib/ayudas';
import { dniNieValido } from '@mmx/domain';

type Linea = NonNullable<RecetaConfirmadaInput['lineas']>[number];
interface RecetaApi {
  id: string;
  estado: string;
  imagenes: { pagina: number; url: string; mime: string }[];
  confirmacion: RecetaConfirmadaInput | null;
  dudosos: string[];
  /** Resultado de la lectura automática (null si no se pudo leer). */
  extraccion: { ocrTexto: string | null; modelo: string } | null;
}
/** Datos de CIMAVet de la presentación elegida (GET /api/medicamentos/presentaciones/:cn/resumen). */
interface ResumenCimavet {
  cn: string;
  nregistro: string;
  presentacion: string;
  medicamento: string;
  labtitular: string | null;
  comerc: boolean;
  forma: string | null;
  principiosActivos: string | null;
  concentracion: string | null;
  autorizadoEspecie: boolean | null;
}
interface StockFefo {
  estado: string;
  propuesta: {
    disponibleTotal: number;
    recomendado: { lote: string; caducidad: string | null } | null;
  } | null;
}
interface Validez {
  validaHasta: string;
  caso: string;
  plazoMaximo: string;
  caducada: boolean;
}
const fechaEs = (iso: string) => iso.split('-').reverse().join('/');
const resumenDe = (cn: string, especie: number | null) =>
  get<ResumenCimavet>(
    `/api/medicamentos/presentaciones/${cn}/resumen${especie ? `?especie=${especie}` : ''}`,
  );

interface Candidato {
  cn: string;
  nregistro: string;
  nombre: string;
  labtitular: string | null;
  comerc: boolean | null;
  puntuacion: number;
  autorizadoEspecie: boolean | null;
}

const ESPECIES = [
  { id: 14, t: 'Perros', prod: false },
  { id: 15, t: 'Gatos', prod: false },
  { id: 119, t: 'Hurones', prod: false },
  { id: 16, t: 'Conejos', prod: false },
  { id: 5, t: 'Caballos', prod: true },
  { id: 1, t: 'Bovino', prod: true },
  { id: 2, t: 'Ovino', prod: true },
  { id: 3, t: 'Caprino', prod: true },
  { id: 7, t: 'Porcino', prod: true },
  { id: 47, t: 'Pollos', prod: true },
];

/** Pantalla de revisión obligatoria (SPEC §4.1.1.3, §8.3). */
export function Revision() {
  const { id } = useParams({ from: '/recetas/$id/revision' });
  const nav = useNavigate();
  // Siempre del servidor al entrar: la copia en caché puede ser anterior a lo guardado (al volver del resultado).
  const q = useQuery({
    queryKey: ['receta', id],
    queryFn: () => get<RecetaApi>(`/api/recetas/${id}`),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [r, setR] = useState<RecetaConfirmadaInput | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pagina, setPagina] = useState(0);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const plataformas = useQuery({
    queryKey: ['plataformas'],
    queryFn: () =>
      get<{ id: string; nombre: string; reconocidaMapa: boolean | null }[]>('/api/admin/plataformas'),
  });
  const cambiado = useRef(false);
  // Las imágenes se piden con autenticación (cabecera) y se muestran como blob local.
  const urlImg = q.data?.imagenes[pagina]?.url;
  const imagen = useQuery({
    queryKey: ['imagen', urlImg],
    queryFn: async () => URL.createObjectURL(await get<Blob>(urlImg as string)),
    enabled: !!urlImg,
    staleTime: Infinity,
  });

  // Validez con los datos del formulario: el aviso de caducada sale aquí, antes de enviar.
  const claveValidez = r && [
    r.fechaEmision,
    r.plazoValidezDeclarado,
    r.tipoTratamiento,
    r.antimicrobianos,
    r.especieProduccion,
    r.cronicoPlanSanitario,
    (r.lineas ?? []).map((l) => l.nregistro),
  ];
  const validez = useQuery({
    queryKey: ['validez', id, JSON.stringify(claveValidez)],
    queryFn: () => post<{ validez: Validez | null }>(`/api/recetas/${id}/validez`, r),
    enabled: !!r?.fechaEmision,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (q.data && q.isFetchedAfterMount && !r)
      setR(q.data.confirmacion ?? ({ tipo: 'papel', lineas: [{ orden: 1 }] } as RecetaConfirmadaInput));
  }, [q.data, q.isFetchedAfterMount, r]);

  // Borrador en servidor: no se pierden datos al recargar ni al salir de la página (SPEC §8).
  const pendiente = useRef<RecetaConfirmadaInput | null>(null);
  useEffect(() => {
    if (!r || !cambiado.current) return;
    pendiente.current = r;
    const t = setTimeout(() => {
      pendiente.current = null;
      void put(`/api/recetas/${id}/confirmacion`, r).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [r, id]);
  useEffect(
    () => () => {
      if (pendiente.current) void put(`/api/recetas/${id}/confirmacion`, pendiente.current).catch(() => {});
    },
    [id],
  );

  if (!q.data || !r) return <Cargando />;
  const dud = (k: string) => q.data.dudosos.includes(k);
  const set = (f: (x: RecetaConfirmadaInput) => RecetaConfirmadaInput) => {
    cambiado.current = true;
    setR((x) => (x ? f(x) : x));
  };
  const v = r.veterinario ?? {};
  const setLinea = (i: number, l: Partial<Linea>) =>
    set((x) => ({ ...x, lineas: (x.lineas ?? []).map((y, j) => (j === i ? { ...y, ...l } : y)) }));
  const txt = (s: string) => (s.trim() === '' ? null : s);

  const evaluar = async () => {
    try {
      await put(`/api/recetas/${id}/confirmacion`, r);
      await nav({ to: '/recetas/$id/resultado', params: { id } });
    } catch (e) {
      setMsg({
        t: 'error',
        m: e instanceof ApiError ? `${e.message} ${JSON.stringify(e.detalles ?? '')}` : 'Error al guardar',
      });
    }
  };

  const img = q.data.imagenes[pagina];
  const src = imagen.data;
  return (
    <Pagina titulo="Revisión de datos">
      <p className="text-slate-700">
        Comprueba cada dato con la receta original. Los campos marcados «Revisar» se han leído con poca
        seguridad o no se han encontrado.
      </p>
      {!q.data.extraccion && (
        <Mensaje tipo="aviso">
          No se ha podido leer la receta automáticamente (el servicio no ha respondido a tiempo o no está
          configurado). Introduce los datos a mano.
        </Mensaje>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Tarjeta>
            <div className="mb-2 flex flex-wrap gap-2">
              {q.data.imagenes.map((im, i) => (
                <Boton
                  key={im.pagina}
                  variante={i === pagina ? 'principal' : 'secundario'}
                  onClick={() => setPagina(i)}
                >
                  Página {im.pagina}
                </Boton>
              ))}
              <Boton
                variante="secundario"
                aria-label="Ampliar"
                onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
              >
                <ZoomIn className="h-5 w-5" />
              </Boton>
              <Boton
                variante="secundario"
                aria-label="Reducir"
                onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
              >
                <ZoomOut className="h-5 w-5" />
              </Boton>
            </div>
            <div className="max-h-[75vh] overflow-auto rounded-xl bg-slate-100">
              {img && img.mime !== 'application/pdf' ? (
                <img src={src} alt={`Receta, página ${img.pagina}`} style={{ width: `${zoom * 100}%` }} />
              ) : img ? (
                <iframe title="Receta en PDF" src={src} className="h-[70vh] w-full" />
              ) : (
                <p className="p-6">Sin imagen</p>
              )}
            </div>
          </Tarjeta>
          {q.data.extraccion?.ocrTexto && <TextoReconocido texto={q.data.extraccion.ocrTexto} />}
        </div>

        <div className="flex flex-col gap-5">
          <Tarjeta titulo="1 · Para dispensar">
            <p className="mb-3 text-sm text-slate-600">
              Lo imprescindible para saber si se puede dispensar y cruzarlo con el envase que vas a entregar.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta texto="Tipo de receta" info={AYUDA.tipo} />
                <select
                  className="min-h-11 rounded-lg border px-2"
                  value={r.tipo}
                  onChange={(e) => set((x) => ({ ...x, tipo: e.target.value as 'papel' | 'electronica' }))}
                >
                  <option value="papel">Papel</option>
                  <option value="electronica">Electrónica</option>
                </select>
              </label>
              <label className="flex items-center gap-3 self-end pb-2">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={!!r.antimicrobianos}
                  onChange={(e) => set((x) => ({ ...x, antimicrobianos: e.target.checked }))}
                />
                <span>
                  Receta de antimicrobianos <Info texto={AYUDA.antimicrobianos} />{' '}
                  {dud('receta.antimicrobianos') && (
                    <span className="rounded bg-dorado/30 px-1.5 text-xs">Revisar</span>
                  )}
                  <span className="block text-xs text-slate-600">
                    Validez de 5 días y declaración del art. 107.3 y 4 en cada medicamento
                  </span>
                </span>
              </label>
              {r.tipo === 'electronica' && (
                <label className="flex flex-col gap-1 text-sm">
                  <Etiqueta texto="Plataforma" info={AYUDA.plataforma} />
                  <select
                    className="min-h-11 rounded-lg border px-2"
                    value={r.plataformaId ?? ''}
                    onChange={(e) => set((x) => ({ ...x, plataformaId: txt(e.target.value) }))}
                  >
                    <option value="">(No figura en la lista)</option>
                    {plataformas.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.reconocidaMapa === null
                          ? ' (pendiente de verificar)'
                          : p.reconocidaMapa
                            ? ''
                            : ' (no reconocida)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Campo
                etiqueta="Nº de receta"
                info={AYUDA.numero}
                dudoso={dud('receta.numero')}
                value={r.numero ?? ''}
                onChange={(e) => set((x) => ({ ...x, numero: txt(e.target.value) }))}
              />
              <div className="flex flex-col gap-1">
                <Campo
                  etiqueta="Fecha de emisión"
                  info={AYUDA.fechaEmision}
                  type="date"
                  dudoso={dud('receta.fechaEmision')}
                  value={r.fechaEmision ?? ''}
                  onChange={(e) => set((x) => ({ ...x, fechaEmision: txt(e.target.value) }))}
                />
                {r.fechaEmision && validez.data?.validez && (
                  <p
                    data-testid="aviso-validez"
                    className={`rounded-lg px-2 py-1 text-sm font-semibold ${validez.data.validez.caducada ? 'bg-red-100 text-red-800' : 'text-slate-600'}`}
                  >
                    {validez.data.validez.caducada
                      ? `Receta caducada: era válida hasta el ${fechaEs(validez.data.validez.validaHasta)} (plazo máximo ${validez.data.validez.plazoMaximo}). No se puede dispensar.`
                      : `Válida hasta el ${fechaEs(validez.data.validez.validaHasta)} (plazo máximo ${validez.data.validez.plazoMaximo})`}
                  </p>
                )}
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta
                  texto="Tipo de dispensación"
                  info={AYUDA.tipoDispensacion}
                  dudoso={dud('receta.tipoDispensacion')}
                />
                <select
                  className="min-h-11 rounded-lg border px-2"
                  value={r.tipoDispensacion ?? ''}
                  onChange={(e) =>
                    set((x) => ({ ...x, tipoDispensacion: (txt(e.target.value) as never) ?? null }))
                  }
                >
                  <option value="">(No consta)</option>
                  <option value="dispensacion">De dispensación</option>
                  <option value="botiquin">De botiquín</option>
                  <option value="no_dispensacion">De no dispensación</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta
                  texto="Clase de prescripción"
                  info={AYUDA.clasePrescripcion}
                  dudoso={dud('receta.clasePrescripcion')}
                />
                <select
                  className="min-h-11 rounded-lg border px-2"
                  value={r.clasePrescripcion ?? ''}
                  onChange={(e) =>
                    set((x) => ({ ...x, clasePrescripcion: (txt(e.target.value) as never) ?? null }))
                  }
                >
                  <option value="">(No consta: se bloquea la sustitución)</option>
                  <option value="ordinaria">Ordinaria</option>
                  <option value="excepcional">Excepcional</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta texto="Tipo de tratamiento" info={AYUDA.tipoTratamiento} />
                <select
                  className="min-h-11 rounded-lg border px-2"
                  value={r.tipoTratamiento ?? ''}
                  onChange={(e) =>
                    set((x) => ({ ...x, tipoTratamiento: (txt(e.target.value) as never) ?? null }))
                  }
                >
                  <option value="">(No consta: agudo)</option>
                  <option value="agudo">Agudo</option>
                  <option value="cronico">Crónico</option>
                  <option value="preventivo">Preventivo</option>
                </select>
              </label>
            </div>
          </Tarjeta>

          <Tarjeta titulo="Veterinario">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Nº de colegiado"
                info={AYUDA.vetColegiado}
                dudoso={dud('receta.veterinarioNumColegiado')}
                value={v.numColegiado ?? ''}
                onChange={(e) =>
                  set((x) => ({ ...x, veterinario: { ...v, numColegiado: txt(e.target.value) } }))
                }
              />
            </div>
            <label className="mt-3 flex items-center gap-3">
              <input
                type="checkbox"
                className="h-6 w-6"
                checked={!!r.talonarioColegial}
                onChange={(e) => set((x) => ({ ...x, talonarioColegial: e.target.checked }))}
              />
              <span>
                Talonario colegial con numeración que incluye el nº de colegiado{' '}
                <Info texto={AYUDA.talonario} />
              </span>
            </label>
            <label className="mt-2 flex items-center gap-3">
              <input
                data-testid="firma"
                type="checkbox"
                className="h-6 w-6"
                checked={!!r.firmaConfirmada}
                onChange={(e) => set((x) => ({ ...x, firmaConfirmada: e.target.checked }))}
              />
              <span>
                {r.tipo === 'papel'
                  ? 'Tiene firma manuscrita en el original (no es una copia)'
                  : 'Consta el registro de emisión en la plataforma'}{' '}
                <Info texto={AYUDA.firma} />
              </span>
            </label>
          </Tarjeta>

          <Tarjeta titulo="Animal">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <Etiqueta texto={`Especie (leído: ${r.especie?.texto ?? '—'})`} info={AYUDA.especie} />
                <select
                  data-testid="especie"
                  className="min-h-11 rounded-lg border px-2"
                  value={r.especie?.especieId ?? ''}
                  onChange={(e) => {
                    const sel = ESPECIES.find((s) => s.id === Number(e.target.value));
                    set((x) => ({
                      ...x,
                      especie: { texto: sel?.t ?? x.especie?.texto ?? null, especieId: sel?.id ?? null },
                      especieProduccion: sel?.prod ?? false,
                    }));
                  }}
                >
                  <option value="">(Elegir)</option>
                  {ESPECIES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={!!r.especieProduccion}
                  onChange={(e) => set((x) => ({ ...x, especieProduccion: e.target.checked }))}
                />
                <span>
                  Animal productor de alimentos <Info texto={AYUDA.produccion} />
                </span>
              </label>
              {r.especieProduccion && r.tipoTratamiento === 'cronico' && (
                <label className="flex items-center gap-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={!!r.cronicoPlanSanitario}
                    onChange={(e) => set((x) => ({ ...x, cronicoPlanSanitario: e.target.checked }))}
                  />
                  Confirmo que este tratamiento crónico está en el plan sanitario de la explotación o lo pauta
                  el veterinario de la ADS (validez de 3 meses) <Info texto={AYUDA.cronicoPlan} />
                </label>
              )}
              {r.especieProduccion && (
                <Campo
                  etiqueta="Código REGA"
                  info={AYUDA.rega}
                  dudoso={dud('receta.rega')}
                  value={r.rega ?? ''}
                  onChange={(e) => set((x) => ({ ...x, rega: txt(e.target.value) }))}
                />
              )}
            </div>
          </Tarjeta>

          {(r.lineas ?? []).map((l, i) => (
            <LineaForm
              key={l.orden}
              l={l}
              i={i}
              dud={dud}
              setLinea={setLinea}
              especie={r.especie?.especieId ?? null}
              // No autorizado para la especie = uso en cascada: prescripción excepcional.
              onCascada={() =>
                set((x) => (x.clasePrescripcion ? x : { ...x, clasePrescripcion: 'excepcional' }))
              }
            />
          ))}

          <TarjetaRegistro r={r} set={set} dud={dud} />

          <Tarjeta>
            <label className="flex items-center gap-3 text-lg font-semibold">
              <input
                data-testid="comprobado"
                type="checkbox"
                className="h-7 w-7"
                checked={!!r.comprobadoConOriginal}
                onChange={(e) => set((x) => ({ ...x, comprobadoConOriginal: e.target.checked }))}
              />
              He comprobado con la receta original los datos para dispensar <Info texto={AYUDA.comprobado} />
            </label>
            {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
            <div className="mt-4 flex flex-wrap gap-3">
              <Boton data-testid="evaluar" disabled={!r.comprobadoConOriginal} onClick={() => void evaluar()}>
                Comprobar la receta
              </Boton>
              <Boton
                variante="secundario"
                onClick={() =>
                  void put(`/api/recetas/${id}/confirmacion`, r).then(() =>
                    setMsg({ t: 'ok', m: 'Borrador guardado' }),
                  )
                }
              >
                Guardar borrador
              </Boton>
            </div>
          </Tarjeta>
        </div>
      </div>
    </Pagina>
  );
}

/** Bloque 2 de la revisión: datos para el registro, con la opción de transcribirlos después de dispensar. */
function TarjetaRegistro({
  r,
  set,
  dud,
}: {
  r: RecetaConfirmadaInput;
  set: (f: (x: RecetaConfirmadaInput) => RecetaConfirmadaInput) => void;
  dud: (k: string) => boolean;
}) {
  const produccion = !!r.especieProduccion;
  const diferido = !!r.registroDiferido && !produccion;
  const [abierto, setAbierto] = useState(!diferido);
  return (
    <Tarjeta titulo="2 · Datos para el registro">
      {produccion ? (
        <p className="mb-3 text-sm text-slate-600">
          Animal productor de alimentos: estos datos se comprueban antes de dispensar.
        </p>
      ) : (
        <label className="mb-3 flex items-start gap-3 rounded-xl bg-fondo p-3">
          <input
            data-testid="registro-diferido"
            type="checkbox"
            className="mt-1 h-6 w-6 shrink-0"
            checked={diferido}
            onChange={(e) => {
              set((x) => ({ ...x, registroDiferido: e.target.checked }));
              setAbierto(!e.target.checked);
            }}
          />
          <span>
            <span className="font-semibold">
              La receta incluye estos datos: los transcribo después de dispensar
            </span>{' '}
            <Info texto={AYUDA.registroDiferido} />
            <span className="block text-sm text-slate-600">
              Titular, veterinario, indicación, identificación del animal y posología. Quedará en «Pendientes»
              hasta que los completes.
            </span>
          </span>
        </label>
      )}
      {diferido && (
        <Boton variante="texto" onClick={() => setAbierto((a) => !a)}>
          {abierto ? 'Ocultar los datos leídos' : 'Ver o corregir ahora los datos leídos'}
        </Boton>
      )}
      {(abierto || !diferido) && <DatosRegistro r={r} set={set} dud={dud} />}
    </Tarjeta>
  );
}

/**
 * Datos para el registro (titular, veterinario, indicación, posología…). En animales de compañía se pueden
 * transcribir después de dispensar si la receta los incluye (dispensación ágil); en producción, antes.
 */
export function DatosRegistro({
  r,
  set,
  dud,
}: {
  r: RecetaConfirmadaInput;
  set: (f: (x: RecetaConfirmadaInput) => RecetaConfirmadaInput) => void;
  dud: (k: string) => boolean;
}) {
  const v = r.veterinario ?? {};
  const txt = (s: string) => (s.trim() === '' ? null : s);
  const setLinea = (i: number, l: Partial<Linea>) =>
    set((x) => ({ ...x, lineas: (x.lineas ?? []).map((y, j) => (j === i ? { ...y, ...l } : y)) }));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          etiqueta="Indicación"
          info={AYUDA.indicacion}
          dudoso={dud('receta.indicacion')}
          value={r.indicacion ?? ''}
          onChange={(e) => set((x) => ({ ...x, indicacion: txt(e.target.value) }))}
        />
        <Campo
          etiqueta="Nombre del veterinario"
          info={AYUDA.vetNombre}
          dudoso={dud('receta.veterinarioNombre')}
          value={v.nombre ?? ''}
          onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, nombre: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Colegio (provincia)"
          info={AYUDA.vetColegio}
          value={v.colegio ?? ''}
          onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, colegio: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Teléfono del veterinario"
          info={AYUDA.vetTelefono}
          dudoso={dud('receta.veterinarioTelefono')}
          value={v.telefono ?? ''}
          onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, telefono: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Correo del veterinario"
          info={AYUDA.vetCorreo}
          value={v.email ?? ''}
          onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, email: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Clínica"
          info={AYUDA.vetClinica}
          value={v.clinica ?? ''}
          onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, clinica: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Nombre del titular"
          info={AYUDA.titularNombre}
          dudoso={dud('receta.titularNombre')}
          value={r.titular?.nombre ?? ''}
          onChange={(e) => set((x) => ({ ...x, titular: { ...x.titular, nombre: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Teléfono del titular"
          info={AYUDA.titularTelefono}
          dudoso={dud('receta.titularTelefono')}
          value={r.titular?.telefono ?? ''}
          onChange={(e) => set((x) => ({ ...x, titular: { ...x.titular, telefono: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="Dirección del titular (opcional)"
          info={AYUDA.titularDireccion}
          autoComplete="off"
          value={r.titular?.direccion ?? ''}
          onChange={(e) => set((x) => ({ ...x, titular: { ...x.titular, direccion: txt(e.target.value) } }))}
        />
        <Campo
          etiqueta="DNI / NIE del titular (opcional)"
          info={AYUDA.titularDni}
          autoComplete="off"
          value={r.titular?.dni ?? ''}
          onChange={(e) =>
            set((x) => ({ ...x, titular: { ...x.titular, dni: txt(e.target.value.toUpperCase()) } }))
          }
          ayuda={
            r.titular?.dni && !dniNieValido(r.titular.dni)
              ? 'El DNI/NIE no es correcto: revisa la letra'
              : undefined
          }
        />
        <Campo
          etiqueta="Identificación (microchip o lote)"
          info={AYUDA.animalIdentificacion}
          dudoso={dud('receta.animalIdentificacion')}
          value={r.animalIdentificacion ?? ''}
          onChange={(e) => set((x) => ({ ...x, animalIdentificacion: txt(e.target.value) }))}
        />
        <Campo
          etiqueta="Nº de animales"
          info={AYUDA.numAnimales}
          type="number"
          min={1}
          value={r.numAnimales ?? ''}
          onChange={(e) =>
            set((x) => ({ ...x, numAnimales: e.target.value ? Number(e.target.value) : null }))
          }
        />
      </div>
      {(r.lineas ?? []).map((l, i) => {
        const k = (c: string) => dud(`lineas.${i}.${c}`);
        return (
          <fieldset key={l.orden} className="rounded-xl border border-slate-200 p-3">
            <legend className="px-1 font-semibold">
              Medicamento {l.orden}
              {l.medicamentoTexto ? ` · ${l.medicamentoTexto}` : ''}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta={`Principio(s) activo(s)${l.cn ? ' (de CIMAVet)' : ''}`}
                info={AYUDA.principioActivo}
                dudoso={k('principioActivo')}
                value={l.principioActivoTexto ?? ''}
                onChange={(e) => setLinea(i, { principioActivoTexto: txt(e.target.value) })}
              />
              <Campo
                etiqueta={`Forma farmacéutica${l.cn ? ' (de CIMAVet)' : ''}`}
                info={AYUDA.forma}
                dudoso={k('forma')}
                value={l.formaTexto ?? ''}
                onChange={(e) => setLinea(i, { formaTexto: txt(e.target.value) })}
              />
              <Campo
                etiqueta={`Concentración${l.cn ? ' (de CIMAVet)' : ''}`}
                info={AYUDA.concentracion}
                dudoso={k('concentracion')}
                value={l.concentracionTexto ?? ''}
                onChange={(e) => setLinea(i, { concentracionTexto: txt(e.target.value) })}
              />
              <Campo
                etiqueta="Formato"
                info={AYUDA.formato}
                value={l.formatoTexto ?? ''}
                onChange={(e) => setLinea(i, { formatoTexto: txt(e.target.value) })}
              />
              <Campo
                etiqueta="Vía"
                info={AYUDA.via}
                value={l.posologia?.via ?? ''}
                onChange={(e) => setLinea(i, { posologia: { ...l.posologia, via: txt(e.target.value) } })}
              />
              <Campo
                etiqueta="Dosis"
                info={AYUDA.dosis}
                value={l.posologia?.dosis ?? ''}
                onChange={(e) => setLinea(i, { posologia: { ...l.posologia, dosis: txt(e.target.value) } })}
              />
              <Campo
                etiqueta="Duración (días)"
                info={AYUDA.duracion}
                type="number"
                value={l.posologia?.duracionDias ?? ''}
                onChange={(e) =>
                  setLinea(i, {
                    posologia: {
                      ...l.posologia,
                      duracionDias: e.target.value ? Number(e.target.value) : null,
                    },
                  })
                }
              />
              <Campo
                etiqueta="Tiempo de espera"
                info={AYUDA.tiempoEspera}
                dudoso={k('tiempoEspera')}
                value={l.tiempoEsperaTexto ?? ''}
                onChange={(e) => setLinea(i, { tiempoEsperaTexto: txt(e.target.value) })}
              />
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function LineaForm({
  l,
  i,
  dud,
  setLinea,
  especie,
  onCascada,
}: {
  l: Linea;
  i: number;
  dud: (k: string) => boolean;
  setLinea: (i: number, l: Partial<Linea>) => void;
  especie: number | null;
  onCascada: () => void;
}) {
  const ficha = useQuery({
    queryKey: ['resumen', l.cn, especie],
    queryFn: () => resumenDe(l.cn as string, especie),
    enabled: !!l.cn,
  });
  // Stock antes de validar: se ve si hay (y cuánto) antes de comprobar la receta (SPEC §4.4).
  const stock = useQuery({
    queryKey: ['stock-revision', l.cn, l.cantidadEnvases],
    queryFn: () => get<StockFefo>(`/api/stock/${l.cn}/fefo?unidades=${l.cantidadEnvases ?? 1}`),
    enabled: !!l.cn,
  });
  const elegir = async (c: Candidato) => {
    setLinea(i, { cn: c.cn, nregistro: c.nregistro });
    setBuscar(false);
    // Forma, principios activos y concentración salen de CIMAVet, no de lo leído.
    const f = await resumenDe(c.cn, especie).catch(() => null);
    if (f)
      setLinea(i, {
        formaTexto: f.forma ?? l.formaTexto ?? null,
        principioActivoTexto: f.principiosActivos ?? l.principioActivoTexto ?? null,
        concentracionTexto: f.concentracion ?? l.concentracionTexto ?? null,
      });
    if (c.autorizadoEspecie === false) onCascada();
  };
  const [busqueda, setBusqueda] = useState(l.medicamentoTexto ?? l.principioActivoTexto ?? '');
  const [buscar, setBuscar] = useState(!l.cn);
  const cand = useQuery({
    queryKey: ['buscar', busqueda, especie],
    queryFn: () =>
      get<Candidato[]>(
        `/api/medicamentos/buscar?q=${encodeURIComponent(busqueda)}${especie ? `&especie=${especie}` : ''}`,
      ),
    enabled: buscar && busqueda.trim().length >= 3,
  });
  const k = (c: string) => dud(`lineas.${i}.${c}`);
  const txt = (s: string) => (s.trim() === '' ? null : s);
  return (
    <Tarjeta titulo={`Medicamento ${l.orden}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          etiqueta="Nombre del medicamento"
          info={AYUDA.medicamento}
          dudoso={k('medicamento')}
          value={l.medicamentoTexto ?? ''}
          onChange={(e) => setLinea(i, { medicamentoTexto: txt(e.target.value) })}
        />
        <Campo
          etiqueta="Nº de envases que pone la receta"
          info={AYUDA.envasesReceta}
          type="number"
          min={1}
          dudoso={k('cantidadEnvases')}
          value={l.cantidadEnvases ?? ''}
          onChange={(e) => setLinea(i, { cantidadEnvases: e.target.value ? Number(e.target.value) : null })}
        />
        <Campo
          etiqueta="Unidades (comprimidos, pipetas…) — solo si la receta las indica"
          info={AYUDA.unidades}
          type="number"
          min={1}
          value={l.unidadesForma ?? ''}
          onChange={(e) => setLinea(i, { unidadesForma: e.target.value ? Number(e.target.value) : null })}
        />
      </div>
      <label className="mt-3 flex items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={!!l.declaracionAntimicrobiano?.declarada}
          onChange={(e) =>
            setLinea(i, {
              declaracionAntimicrobiano: e.target.checked ? { declarada: true, finalidad: null } : null,
            })
          }
        />
        <span>
          Consta la declaración del art. 107.3 y 4 del Reglamento (UE) 2019/6 (antimicrobianos){' '}
          <Info texto={AYUDA.declaracion} />
        </span>
      </label>

      <div className="mt-4 rounded-xl bg-fondo p-3">
        <p className="font-semibold">
          Medicamento en CIMAVet <Info texto={AYUDA.cimavet} />
        </p>
        {l.cn && !buscar ? (
          <div className="mt-1" data-testid="ficha-cimavet">
            {ficha.data ? (
              <>
                <p className="text-lg font-semibold">{ficha.data.presentacion}</p>
                <p className="text-sm text-slate-700">
                  {[
                    ficha.data.forma,
                    ficha.data.principiosActivos &&
                      `${ficha.data.principiosActivos}${ficha.data.concentracion ? ` ${ficha.data.concentracion}` : ''}`,
                    ficha.data.labtitular,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {ficha.data.autorizadoEspecie === false && (
                  <p className="mt-1 text-sm font-semibold text-sustituir">
                    No autorizado para esta especie: uso excepcional por cascada
                  </p>
                )}
                {!ficha.data.comerc && (
                  <p className="mt-1 text-sm font-semibold text-sustituir">No comercializado</p>
                )}
              </>
            ) : (
              ficha.isError && (
                <p className="text-sm font-semibold text-red-800">Este código nacional no está en CIMAVet</p>
              )
            )}
            <PanelStock s={stock.data} cargando={stock.isLoading} pedidos={l.cantidadEnvases ?? null} />
            <p className="text-sm text-slate-600">
              {CN} <strong>{l.cn}</strong> · nº de registro {l.nregistro}{' '}
              <Boton variante="texto" onClick={() => setBuscar(true)}>
                Cambiar
              </Boton>
            </p>
          </div>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <input
                aria-label="Buscar medicamento"
                className="min-h-11 flex-1 rounded-lg border px-3"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <Search aria-hidden className="h-6 w-6 self-center text-marca" />
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Elige el medicamento y la presentación exactos. Nunca se elige solo.
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {cand.data?.map((c, j) => (
                <li
                  key={c.cn}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 ring-1 ${j === 0 ? 'ring-marca' : 'ring-slate-200'}`}
                >
                  <span className="text-sm">
                    {c.nombre}
                    <br />
                    <span className="text-slate-600">
                      {CN} {c.cn} · {c.labtitular ?? '—'} {c.comerc === false && '· no comercializado'}
                    </span>
                    {c.autorizadoEspecie === false && (
                      <span className="mt-1 block font-semibold text-sustituir">
                        No autorizado para esta especie (uso excepcional por cascada)
                      </span>
                    )}
                  </span>
                  <Boton
                    data-testid={`elegir-${c.cn}`}
                    variante={j === 0 ? 'principal' : 'secundario'}
                    onClick={() => void elegir(c)}
                  >
                    Elegir
                  </Boton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Tarjeta>
  );
}

/** Stock en la farmacia del medicamento elegido, comparado con los envases que pide la receta. */
function PanelStock({
  s,
  cargando,
  pedidos,
}: {
  s: StockFefo | undefined;
  cargando: boolean;
  pedidos: number | null;
}) {
  if (cargando) return <p className="mt-2 animate-pulse text-sm">Consultando el stock…</p>;
  if (!s) return null;
  if (s.estado !== 'OK' || !s.propuesta)
    return (
      <p className="mt-2 rounded-lg bg-sustituir-bg px-2 py-1 text-sm font-semibold text-sustituir">
        No se ha podido consultar el stock ahora
      </p>
    );
  const hay = s.propuesta.disponibleTotal;
  const falta = pedidos !== null && hay < pedidos;
  const rec = s.propuesta.recomendado;
  return (
    <p
      data-testid="stock-revision"
      className={`mt-2 rounded-lg px-2 py-1 text-sm font-semibold ${hay === 0 ? 'bg-noconforme-bg text-noconforme' : falta ? 'bg-sustituir-bg text-sustituir' : 'bg-dispensar-bg text-dispensar'}`}
    >
      {hay === 0 ? 'Sin stock en la farmacia' : `En stock: ${hay} ${hay === 1 ? 'envase' : 'envases'}`}
      {pedidos !== null && ` · la receta pide ${pedidos}`}
      {falta && hay > 0 && ' (no llega)'}
      {rec && ` · lote a usar: ${rec.lote}${rec.caducidad ? ` (caduca el ${fechaEs(rec.caducidad)})` : ''}`}
    </p>
  );
}

/** Texto reconocido de la receta, seleccionable, para copiar y pegar en los campos. */
export function TextoReconocido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Tarjeta titulo="Texto reconocido (puedes copiar y pegar)">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm select-text">
        {texto.replaceAll('--- página ---', '— página siguiente —')}
      </pre>
      <Boton
        variante="texto"
        onClick={() =>
          void navigator.clipboard?.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          })
        }
      >
        <Copy aria-hidden className="h-4 w-4" /> {copiado ? 'Copiado' : 'Copiar todo'}
      </Boton>
    </Tarjeta>
  );
}
