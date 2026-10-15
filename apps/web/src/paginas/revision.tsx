import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Copy, Search, ZoomIn, ZoomOut } from 'lucide-react';
import type { RecetaConfirmadaInput } from '@mmx/shared';
import { ApiError, get, post, put } from '../lib/api';
import { CN } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Cargando, Mensaje, Tarjeta } from '../componentes/ui';

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
interface Validez {
  validaHasta: string;
  caso: string;
  plazoMaximo: string;
  caducada: boolean;
}
const fechaEs = (iso: string) => iso.split('-').reverse().join('/');
const resumenDe = (cn: string, especie: number | null) => get<ResumenCimavet>(`/api/medicamentos/presentaciones/${cn}/resumen${especie ? `?especie=${especie}` : ''}`);

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
  const q = useQuery({ queryKey: ['receta', id], queryFn: () => get<RecetaApi>(`/api/recetas/${id}`) });
  const [r, setR] = useState<RecetaConfirmadaInput | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pagina, setPagina] = useState(0);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const plataformas = useQuery({ queryKey: ['plataformas'], queryFn: () => get<{ id: string; nombre: string; reconocidaMapa: boolean | null }[]>('/api/admin/plataformas') });
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
  const claveValidez = r && [r.fechaEmision, r.plazoValidezDeclarado, r.tipoTratamiento, r.antimicrobianos, r.especieProduccion, r.cronicoPlanSanitario, (r.lineas ?? []).map((l) => l.nregistro)];
  const validez = useQuery({
    queryKey: ['validez', id, JSON.stringify(claveValidez)],
    queryFn: () => post<{ validez: Validez | null }>(`/api/recetas/${id}/validez`, r),
    enabled: !!r?.fechaEmision,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (q.data && !r) setR(q.data.confirmacion ?? ({ tipo: 'papel', lineas: [{ orden: 1 }] } as RecetaConfirmadaInput));
  }, [q.data, r]);

  // Borrador en servidor: no se pierden datos al recargar (SPEC §8).
  useEffect(() => {
    if (!r || !cambiado.current) return;
    const t = setTimeout(() => void put(`/api/recetas/${id}/confirmacion`, r).catch(() => {}), 2000);
    return () => clearTimeout(t);
  }, [r, id]);

  if (!q.data || !r) return <Cargando />;
  const dud = (k: string) => q.data.dudosos.includes(k);
  const set = (f: (x: RecetaConfirmadaInput) => RecetaConfirmadaInput) => {
    cambiado.current = true;
    setR((x) => (x ? f(x) : x));
  };
  const v = r.veterinario ?? {};
  const setLinea = (i: number, l: Partial<Linea>) => set((x) => ({ ...x, lineas: (x.lineas ?? []).map((y, j) => (j === i ? { ...y, ...l } : y)) }));
  const txt = (s: string) => (s.trim() === '' ? null : s);

  const evaluar = async () => {
    try {
      await put(`/api/recetas/${id}/confirmacion`, r);
      await nav({ to: '/recetas/$id/resultado', params: { id } });
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? `${e.message} ${JSON.stringify(e.detalles ?? '')}` : 'Error al guardar' });
    }
  };

  const img = q.data.imagenes[pagina];
  const src = imagen.data;
  return (
    <Pagina titulo="Revisión de datos">
      <p className="text-slate-700">Comprueba cada dato con la receta original. Los campos marcados «Revisar» se han leído con poca seguridad o no se han encontrado.</p>
      {!q.data.extraccion && (
        <Mensaje tipo="aviso">No se ha podido leer la receta automáticamente (el servicio no ha respondido a tiempo o no está configurado). Introduce los datos a mano.</Mensaje>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Tarjeta>
            <div className="mb-2 flex flex-wrap gap-2">
              {q.data.imagenes.map((im, i) => (
                <Boton key={im.pagina} variante={i === pagina ? 'principal' : 'secundario'} onClick={() => setPagina(i)}>
                  Página {im.pagina}
                </Boton>
              ))}
              <Boton variante="secundario" aria-label="Ampliar" onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>
                <ZoomIn className="h-5 w-5" />
              </Boton>
              <Boton variante="secundario" aria-label="Reducir" onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>
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
          <Tarjeta titulo="Receta">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Tipo de receta</span>
                <select className="min-h-11 rounded-lg border px-2" value={r.tipo} onChange={(e) => set((x) => ({ ...x, tipo: e.target.value as 'papel' | 'electronica' }))}>
                  <option value="papel">Papel</option>
                  <option value="electronica">Electrónica</option>
                </select>
              </label>
              <label className="flex items-center gap-3 self-end pb-2">
                <input type="checkbox" className="h-6 w-6" checked={!!r.antimicrobianos} onChange={(e) => set((x) => ({ ...x, antimicrobianos: e.target.checked }))} />
                <span>
                  Receta de antimicrobianos {dud('receta.antimicrobianos') && <span className="rounded bg-dorado/30 px-1.5 text-xs">Revisar</span>}
                  <span className="block text-xs text-slate-600">Validez de 5 días y declaración del art. 107.3 y 4 en cada medicamento</span>
                </span>
              </label>
              {r.tipo === 'electronica' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Plataforma</span>
                  <select className="min-h-11 rounded-lg border px-2" value={r.plataformaId ?? ''} onChange={(e) => set((x) => ({ ...x, plataformaId: txt(e.target.value) }))}>
                    <option value="">(No figura en la lista)</option>
                    {plataformas.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.reconocidaMapa === null ? ' (pendiente de verificar)' : p.reconocidaMapa ? '' : ' (no reconocida)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Campo etiqueta="Nº de receta" dudoso={dud('receta.numero')} value={r.numero ?? ''} onChange={(e) => set((x) => ({ ...x, numero: txt(e.target.value) }))} />
              <div className="flex flex-col gap-1">
                <Campo etiqueta="Fecha de emisión" type="date" dudoso={dud('receta.fechaEmision')} value={r.fechaEmision ?? ''} onChange={(e) => set((x) => ({ ...x, fechaEmision: txt(e.target.value) }))} />
                {r.fechaEmision && validez.data?.validez && (
                  <p data-testid="aviso-validez" className={`rounded-lg px-2 py-1 text-sm font-semibold ${validez.data.validez.caducada ? 'bg-red-100 text-red-800' : 'text-slate-600'}`}>
                    {validez.data.validez.caducada
                      ? `Receta caducada: era válida hasta el ${fechaEs(validez.data.validez.validaHasta)} (plazo máximo ${validez.data.validez.plazoMaximo}). No se puede dispensar.`
                      : `Válida hasta el ${fechaEs(validez.data.validez.validaHasta)} (plazo máximo ${validez.data.validez.plazoMaximo})`}
                  </p>
                )}
              </div>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Tipo de dispensación {dud('receta.tipoDispensacion') && <span className="rounded bg-dorado/30 px-1.5 text-xs">Revisar</span>}</span>
                <select className="min-h-11 rounded-lg border px-2" value={r.tipoDispensacion ?? ''} onChange={(e) => set((x) => ({ ...x, tipoDispensacion: (txt(e.target.value) as never) ?? null }))}>
                  <option value="">(No consta)</option>
                  <option value="dispensacion">De dispensación</option>
                  <option value="botiquin">De botiquín</option>
                  <option value="no_dispensacion">De no dispensación</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Clase de prescripción {dud('receta.clasePrescripcion') && <span className="rounded bg-dorado/30 px-1.5 text-xs">Revisar</span>}</span>
                <select className="min-h-11 rounded-lg border px-2" value={r.clasePrescripcion ?? ''} onChange={(e) => set((x) => ({ ...x, clasePrescripcion: (txt(e.target.value) as never) ?? null }))}>
                  <option value="">(No consta: se bloquea la sustitución)</option>
                  <option value="ordinaria">Ordinaria</option>
                  <option value="excepcional">Excepcional</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Tipo de tratamiento</span>
                <select className="min-h-11 rounded-lg border px-2" value={r.tipoTratamiento ?? ''} onChange={(e) => set((x) => ({ ...x, tipoTratamiento: (txt(e.target.value) as never) ?? null }))}>
                  <option value="">(No consta: agudo)</option>
                  <option value="agudo">Agudo</option>
                  <option value="cronico">Crónico</option>
                  <option value="preventivo">Preventivo</option>
                </select>
              </label>
              <Campo etiqueta="Indicación" dudoso={dud('receta.indicacion')} value={r.indicacion ?? ''} onChange={(e) => set((x) => ({ ...x, indicacion: txt(e.target.value) }))} />
            </div>
          </Tarjeta>

          <Tarjeta titulo="Veterinario">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre" dudoso={dud('receta.veterinarioNombre')} value={v.nombre ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, nombre: txt(e.target.value) } }))} />
              <Campo etiqueta="Nº de colegiado" dudoso={dud('receta.veterinarioNumColegiado')} value={v.numColegiado ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, numColegiado: txt(e.target.value) } }))} />
              <Campo etiqueta="Colegio" value={v.colegio ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, colegio: txt(e.target.value) } }))} />
              <Campo etiqueta="Teléfono" dudoso={dud('receta.veterinarioTelefono')} value={v.telefono ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, telefono: txt(e.target.value) } }))} />
              <Campo etiqueta="Correo" value={v.email ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, email: txt(e.target.value) } }))} />
              <Campo etiqueta="Clínica" value={v.clinica ?? ''} onChange={(e) => set((x) => ({ ...x, veterinario: { ...v, clinica: txt(e.target.value) } }))} />
            </div>
            <label className="mt-3 flex items-center gap-3">
              <input type="checkbox" className="h-6 w-6" checked={!!r.talonarioColegial} onChange={(e) => set((x) => ({ ...x, talonarioColegial: e.target.checked }))} />
              <span>Talonario colegial con numeración que incluye el nº de colegiado</span>
            </label>
            <label className="mt-2 flex items-center gap-3">
              <input data-testid="firma" type="checkbox" className="h-6 w-6" checked={!!r.firmaConfirmada} onChange={(e) => set((x) => ({ ...x, firmaConfirmada: e.target.checked }))} />
              <span>{r.tipo === 'papel' ? 'Tiene firma manuscrita en el original (no es una copia)' : 'Consta el registro de emisión en la plataforma'}</span>
            </label>
          </Tarjeta>

          <Tarjeta titulo="Titular y animal">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre del titular" dudoso={dud('receta.titularNombre')} value={r.titular?.nombre ?? ''} onChange={(e) => set((x) => ({ ...x, titular: { ...x.titular, nombre: txt(e.target.value) } }))} />
              <Campo etiqueta="Teléfono del titular" dudoso={dud('receta.titularTelefono')} value={r.titular?.telefono ?? ''} onChange={(e) => set((x) => ({ ...x, titular: { ...x.titular, telefono: txt(e.target.value) } }))} />
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Especie (leído: {r.especie?.texto ?? '—'})</span>
                <select
                  data-testid="especie"
                  className="min-h-11 rounded-lg border px-2"
                  value={r.especie?.especieId ?? ''}
                  onChange={(e) => {
                    const sel = ESPECIES.find((s) => s.id === Number(e.target.value));
                    set((x) => ({ ...x, especie: { texto: sel?.t ?? x.especie?.texto ?? null, especieId: sel?.id ?? null }, especieProduccion: sel?.prod ?? false }));
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
                <input type="checkbox" className="h-6 w-6" checked={!!r.especieProduccion} onChange={(e) => set((x) => ({ ...x, especieProduccion: e.target.checked }))} />
                <span>Animal productor de alimentos</span>
              </label>
              <Campo etiqueta="Identificación (microchip o lote)" dudoso={dud('receta.animalIdentificacion')} value={r.animalIdentificacion ?? ''} onChange={(e) => set((x) => ({ ...x, animalIdentificacion: txt(e.target.value) }))} />
              <Campo etiqueta="Nº de animales" type="number" min={1} value={r.numAnimales ?? ''} onChange={(e) => set((x) => ({ ...x, numAnimales: e.target.value ? Number(e.target.value) : null }))} />
              {r.especieProduccion && r.tipoTratamiento === 'cronico' && (
                <label className="flex items-center gap-3 sm:col-span-2">
                  <input type="checkbox" className="h-6 w-6" checked={!!r.cronicoPlanSanitario} onChange={(e) => set((x) => ({ ...x, cronicoPlanSanitario: e.target.checked }))} />
                  Confirmo que este tratamiento crónico está en el plan sanitario de la explotación o lo pauta el veterinario de la ADS (validez de 3 meses)
                </label>
              )}
              {r.especieProduccion && <Campo etiqueta="Código REGA" dudoso={dud('receta.rega')} value={r.rega ?? ''} onChange={(e) => set((x) => ({ ...x, rega: txt(e.target.value) }))} />}
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
              onCascada={() => set((x) => (x.clasePrescripcion ? x : { ...x, clasePrescripcion: 'excepcional' }))}
            />
          ))}

          <Tarjeta>
            <label className="flex items-center gap-3 text-lg font-semibold">
              <input data-testid="comprobado" type="checkbox" className="h-7 w-7" checked={!!r.comprobadoConOriginal} onChange={(e) => set((x) => ({ ...x, comprobadoConOriginal: e.target.checked }))} />
              He comprobado los datos con el original
            </label>
            {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
            <div className="mt-4 flex flex-wrap gap-3">
              <Boton data-testid="evaluar" disabled={!r.comprobadoConOriginal} onClick={() => void evaluar()}>
                Comprobar la receta
              </Boton>
              <Boton variante="secundario" onClick={() => void put(`/api/recetas/${id}/confirmacion`, r).then(() => setMsg({ t: 'ok', m: 'Borrador guardado' }))}>
                Guardar borrador
              </Boton>
            </div>
          </Tarjeta>
        </div>
      </div>
    </Pagina>
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
  const ficha = useQuery({ queryKey: ['resumen', l.cn, especie], queryFn: () => resumenDe(l.cn as string, especie), enabled: !!l.cn });
  const elegir = async (c: Candidato) => {
    setLinea(i, { cn: c.cn, nregistro: c.nregistro });
    setBuscar(false);
    // Forma, principios activos y concentración salen de CIMAVet, no de lo leído.
    const f = await resumenDe(c.cn, especie).catch(() => null);
    if (f) setLinea(i, { formaTexto: f.forma ?? l.formaTexto ?? null, principioActivoTexto: f.principiosActivos ?? l.principioActivoTexto ?? null, concentracionTexto: f.concentracion ?? l.concentracionTexto ?? null });
    if (c.autorizadoEspecie === false) onCascada();
  };
  const [busqueda, setBusqueda] = useState(l.medicamentoTexto ?? l.principioActivoTexto ?? '');
  const [buscar, setBuscar] = useState(!l.cn);
  const cand = useQuery({
    queryKey: ['buscar', busqueda, especie],
    queryFn: () => get<Candidato[]>(`/api/medicamentos/buscar?q=${encodeURIComponent(busqueda)}${especie ? `&especie=${especie}` : ''}`),
    enabled: buscar && busqueda.trim().length >= 3,
  });
  const k = (c: string) => dud(`lineas.${i}.${c}`);
  const txt = (s: string) => (s.trim() === '' ? null : s);
  return (
    <Tarjeta titulo={`Medicamento ${l.orden}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre del medicamento" dudoso={k('medicamento')} value={l.medicamentoTexto ?? ''} onChange={(e) => setLinea(i, { medicamentoTexto: txt(e.target.value) })} />
        <Campo etiqueta={`Principio(s) activo(s)${l.cn ? ' (de CIMAVet)' : ''}`} dudoso={k('principioActivo')} value={l.principioActivoTexto ?? ''} onChange={(e) => setLinea(i, { principioActivoTexto: txt(e.target.value) })} />
        <Campo etiqueta={`Forma farmacéutica${l.cn ? ' (de CIMAVet)' : ''}`} dudoso={k('forma')} value={l.formaTexto ?? ''} onChange={(e) => setLinea(i, { formaTexto: txt(e.target.value) })} />
        <Campo etiqueta={`Concentración${l.cn ? ' (de CIMAVet)' : ''}`} dudoso={k('concentracion')} value={l.concentracionTexto ?? ''} onChange={(e) => setLinea(i, { concentracionTexto: txt(e.target.value) })} />
        <Campo etiqueta="Nº de envases" type="number" min={1} dudoso={k('cantidadEnvases')} value={l.cantidadEnvases ?? ''} onChange={(e) => setLinea(i, { cantidadEnvases: e.target.value ? Number(e.target.value) : null })} />
        <Campo
          etiqueta="Unidades (comprimidos, pipetas…) — solo si la receta las indica"
          type="number"
          min={1}
          value={l.unidadesForma ?? ''}
          onChange={(e) => setLinea(i, { unidadesForma: e.target.value ? Number(e.target.value) : null })}
        />
        <Campo etiqueta="Formato" value={l.formatoTexto ?? ''} onChange={(e) => setLinea(i, { formatoTexto: txt(e.target.value) })} />
        <Campo etiqueta="Vía" value={l.posologia?.via ?? ''} onChange={(e) => setLinea(i, { posologia: { ...l.posologia, via: txt(e.target.value) } })} />
        <Campo etiqueta="Dosis" value={l.posologia?.dosis ?? ''} onChange={(e) => setLinea(i, { posologia: { ...l.posologia, dosis: txt(e.target.value) } })} />
        <Campo etiqueta="Duración (días)" type="number" value={l.posologia?.duracionDias ?? ''} onChange={(e) => setLinea(i, { posologia: { ...l.posologia, duracionDias: e.target.value ? Number(e.target.value) : null } })} />
        <Campo etiqueta="Tiempo de espera" dudoso={k('tiempoEspera')} value={l.tiempoEsperaTexto ?? ''} onChange={(e) => setLinea(i, { tiempoEsperaTexto: txt(e.target.value) })} />
      </div>
      <label className="mt-3 flex items-center gap-3">
        <input type="checkbox" className="h-6 w-6" checked={!!l.declaracionAntimicrobiano?.declarada} onChange={(e) => setLinea(i, { declaracionAntimicrobiano: e.target.checked ? { declarada: true, finalidad: null } : null })} />
        <span>Consta la declaración del art. 107.3 y 4 del Reglamento (UE) 2019/6 (antimicrobianos)</span>
      </label>

      <div className="mt-4 rounded-xl bg-fondo p-3">
        <p className="font-semibold">Medicamento en CIMAVet</p>
        {l.cn && !buscar ? (
          <div className="mt-1" data-testid="ficha-cimavet">
            {ficha.data ? (
              <>
                <p className="text-lg font-semibold">{ficha.data.presentacion}</p>
                <p className="text-sm text-slate-700">
                  {[ficha.data.forma, ficha.data.principiosActivos && `${ficha.data.principiosActivos}${ficha.data.concentracion ? ` ${ficha.data.concentracion}` : ''}`, ficha.data.labtitular].filter(Boolean).join(' · ')}
                </p>
                {ficha.data.autorizadoEspecie === false && <p className="mt-1 text-sm font-semibold text-sustituir">No autorizado para esta especie: uso excepcional por cascada</p>}
                {!ficha.data.comerc && <p className="mt-1 text-sm font-semibold text-sustituir">No comercializado</p>}
              </>
            ) : (
              ficha.isError && <p className="text-sm font-semibold text-red-800">Este código nacional no está en CIMAVet</p>
            )}
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
              <input aria-label="Buscar medicamento" className="min-h-11 flex-1 rounded-lg border px-3" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              <Search aria-hidden className="h-6 w-6 self-center text-marca" />
            </div>
            <p className="mt-1 text-xs text-slate-600">Elige el medicamento y la presentación exactos. Nunca se elige solo.</p>
            <ul className="mt-2 flex flex-col gap-2">
              {cand.data?.map((c, j) => (
                <li key={c.cn} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 ring-1 ${j === 0 ? 'ring-marca' : 'ring-slate-200'}`}>
                  <span className="text-sm">
                    {c.nombre}
                    <br />
                    <span className="text-slate-600">
                      {CN} {c.cn} · {c.labtitular ?? '—'} {c.comerc === false && '· no comercializado'}
                    </span>
                    {c.autorizadoEspecie === false && (
                      <span className="mt-1 block font-semibold text-sustituir">No autorizado para esta especie (uso excepcional por cascada)</span>
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

/** Texto reconocido de la receta, seleccionable, para copiar y pegar en los campos. */
function TextoReconocido({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Tarjeta titulo="Texto reconocido (puedes copiar y pegar)">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm select-text">{texto.replaceAll('--- página ---', '— página siguiente —')}</pre>
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
