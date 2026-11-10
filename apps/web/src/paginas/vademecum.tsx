import { useState } from 'react';
import type { RespuestaCompararMedicamentos } from '@mmx/shared';
import { ApiError, post } from '../lib/api';
import { useBusquedaMedicamentos } from '../lib/busqueda';
import { EstadoBusqueda, ListaResultados } from '../componentes/estado-busqueda';
import { Pagina } from '../componentes/layout';
import { Boton, Mensaje, Tarjeta } from '../componentes/ui';
import { TablaComparativaCriterios } from '../componentes/asistente';

interface BusquedaItem {
  cn: string;
  nregistro: string;
  nombre: string;
  medicamento: string;
  labtitular: string | null;
}

const ESPECIES_COMUNES = [
  'Perro',
  'Gato',
  'Bovino',
  'Equino',
  'Porcino',
  'Ovino',
  'Caprino',
  'Conejo',
  'Aves',
];

export function Vademecum() {
  const [qA, setQA] = useState('');
  const [qB, setQB] = useState('');
  const [medA, setMedA] = useState<BusquedaItem | null>(null);
  const [medB, setMedB] = useState<BusquedaItem | null>(null);
  const busA = useBusquedaMedicamentos<BusquedaItem>(qA, { activo: !medA });
  const busB = useBusquedaMedicamentos<BusquedaItem>(qB, { activo: !medB });
  const [especie, setEspecie] = useState('Perro');
  const [indicacion, setIndicacion] = useState('');
  const [comparando, setComparando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaCompararMedicamentos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const comparar = async () => {
    if (!medA || !medB) {
      setError('Selecciona tanto el medicamento de referencia (A) como el sustituto candidato (B)');
      return;
    }
    setComparando(true);
    setError(null);
    try {
      const res = await post<RespuestaCompararMedicamentos>('/api/medicamentos/comparar', {
        prescritoNregistro: medA.nregistro,
        candidatoNregistro: medB.nregistro,
        especie,
        indicacion: indicacion.trim() || undefined,
      });
      setResultado(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al comparar medicamentos');
      setResultado(null);
    } finally {
      setComparando(false);
    }
  };

  return (
    <Pagina titulo="Vademécum · Comparador de sustitución">
      <p className="text-slate-600 mb-6 text-sm">
        Herramienta de verificación reglamentaria oficial (RD 1157/2021). Contrasta la equivalencia técnica
        entre dos medicamentos veterinarios autorizados en CIMAVet desglosando los 7 criterios normativos.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Medicamento A */}
        <Tarjeta titulo="1. Medicamento prescrito o de referencia (A)">
          {!medA ? (
            <div className="space-y-2">
              <label htmlFor="input-med-a" className="block text-xs font-semibold text-slate-700">
                Buscar en vademécum
              </label>
              <input
                id="input-med-a"
                type="search"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                placeholder="Nombre, principio activo o Código nacional..."
                value={qA}
                onChange={(e) => setQA(e.target.value)}
                data-testid="input-med-a"
              />
              <EstadoBusqueda
                estado={busA.estado}
                texto={qA}
                resultados={Math.min(busA.resultados.length, 6)}
                onReintentar={busA.reintentar}
              />
              {busA.resultados.length > 0 && (
                <ListaResultados desfasada={busA.desfasada}>
                  <ul className="divide-y divide-borde border border-borde rounded-lg max-h-48 overflow-y-auto text-sm bg-superficie text-texto">
                    {busA.resultados.slice(0, 6).map((it) => (
                      <li
                        key={it.cn}
                        className="p-2 hover:bg-fondo-secundario cursor-pointer flex justify-between items-center"
                        onClick={() => {
                          setMedA(it);
                          setQA(it.nombre);
                        }}
                      >
                        <div>
                          <strong className="block text-texto">{it.nombre}</strong>
                          <span className="text-xs text-texto-muted dark:text-slate-400">
                            CN {it.cn} · {it.labtitular ?? '—'}
                          </span>
                        </div>
                        <span className="text-xs text-marca font-medium">Elegir</span>
                      </li>
                    ))}
                  </ul>
                </ListaResultados>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 flex justify-between items-center">
              <div>
                <strong className="block text-slate-900">{medA.nombre}</strong>
                <span className="text-xs text-slate-500">
                  CN {medA.cn} · {medA.labtitular ?? '—'} · Reg: {medA.nregistro}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMedA(null);
                  setQA('');
                }}
                className="text-xs text-marca underline"
              >
                Cambiar
              </button>
            </div>
          )}
        </Tarjeta>

        {/* Medicamento B */}
        <Tarjeta titulo="2. Medicamento candidato o sustituto (B)">
          {!medB ? (
            <div className="space-y-2">
              <label htmlFor="input-med-b" className="block text-xs font-semibold text-slate-700">
                Buscar en vademécum
              </label>
              <input
                id="input-med-b"
                type="search"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                placeholder="Nombre, principio activo o Código nacional..."
                value={qB}
                onChange={(e) => setQB(e.target.value)}
                data-testid="input-med-b"
              />
              <EstadoBusqueda
                estado={busB.estado}
                texto={qB}
                resultados={Math.min(busB.resultados.length, 6)}
                onReintentar={busB.reintentar}
              />
              {busB.resultados.length > 0 && (
                <ListaResultados desfasada={busB.desfasada}>
                  <ul className="divide-y divide-borde border border-borde rounded-lg max-h-48 overflow-y-auto text-sm bg-superficie text-texto">
                    {busB.resultados.slice(0, 6).map((it) => (
                      <li
                        key={it.cn}
                        className="p-2 hover:bg-fondo-secundario cursor-pointer flex justify-between items-center"
                        onClick={() => {
                          setMedB(it);
                          setQB(it.nombre);
                        }}
                      >
                        <div>
                          <strong className="block text-texto">{it.nombre}</strong>
                          <span className="text-xs text-texto-muted dark:text-slate-400">
                            CN {it.cn} · {it.labtitular ?? '—'}
                          </span>
                        </div>
                        <span className="text-xs text-marca dark:text-acento font-medium">Elegir</span>
                      </li>
                    ))}
                  </ul>
                </ListaResultados>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 flex justify-between items-center">
              <div>
                <strong className="block text-slate-900">{medB.nombre}</strong>
                <span className="text-xs text-slate-500">
                  CN {medB.cn} · {medB.labtitular ?? '—'} · Reg: {medB.nregistro}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMedB(null);
                  setQB('');
                }}
                className="text-xs text-marca underline"
              >
                Cambiar
              </button>
            </div>
          )}
        </Tarjeta>
      </div>

      {/* Parámetros de prescripción */}
      <div className="mt-6">
        <Tarjeta titulo="3. Parámetros de destino">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="select-especie" className="block text-xs font-semibold text-texto mb-1">
                Especie animal
              </label>
              <select
                id="select-especie"
                className="w-full rounded-lg border border-borde p-2 text-sm bg-superficie text-texto"
                value={especie}
                onChange={(e) => setEspecie(e.target.value)}
                data-testid="select-especie"
              >
                {ESPECIES_COMUNES.map((esp) => (
                  <option key={esp} value={esp}>
                    {esp}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="input-indicacion" className="block text-xs font-semibold text-slate-700 mb-1">
                Indicación o patología clínica (opcional)
              </label>
              <input
                id="input-indicacion"
                type="text"
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                placeholder="Ej. Infección cutánea, dermatitis..."
                value={indicacion}
                onChange={(e) => setIndicacion(e.target.value)}
                data-testid="input-indicacion"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Boton
              onClick={() => void comparar()}
              disabled={!medA || !medB || comparando}
              data-testid="btn-comparar"
            >
              {comparando ? 'Comparando con el motor...' : 'Comparar medicamentos'}
            </Boton>
          </div>
        </Tarjeta>
      </div>

      {error && (
        <div className="mt-4">
          <Mensaje tipo="error">{error}</Mensaje>
        </div>
      )}

      {/* Resultado de la comparación */}
      {resultado && (
        <div className="mt-6 space-y-4" data-testid="resultado-comparacion">
          <Tarjeta
            titulo={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Resultado de la evaluación técnica</span>
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    resultado.decision === 'EQUIVALENTE'
                      ? 'bg-dispensar-bg text-dispensar'
                      : 'bg-noconforme-bg text-noconforme'
                  }`}
                >
                  {resultado.decision === 'EQUIVALENTE' ? '✓ Equivalente reglamentario' : '✗ No equivalente'}
                </span>
              </div>
            }
          >
            {resultado.motivos.length > 0 && (
              <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-800">Motivos observados por el motor:</p>
                <ul className="mt-1 list-disc pl-5 space-y-1">
                  {resultado.motivos.map((m, idx) => (
                    <li key={idx}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-slate-800">
                Desglose de los 7 criterios de equivalencia (RD 1157/2021)
              </h4>
              <TablaComparativaCriterios comparativa={resultado.evidencias.comparativa} />
            </div>

            {resultado.esBloqueanteDuro && (
              <p className="mt-4 rounded-lg bg-noconforme-bg p-3 text-sm font-semibold text-noconforme">
                Bloqueo legal insubsanable: uno o ambos medicamentos son biológicos, inmunológicos o se trata
                de una prescripción no autorizada. La sustitución por el dispensador está prohibida por ley.
              </p>
            )}

            {resultado.decision === 'EQUIVALENTE' && !resultado.esBloqueanteDuro && (
              <div className="mt-4 rounded-lg bg-pedir-bg p-3 text-xs text-slate-700 space-y-1">
                <p className="font-semibold text-marca">
                  Obligaciones legales del dispensador ante la sustitución (RD 1157/2021):
                </p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>Obtener el consentimiento previo del tutor del animal.</li>
                  <li>Notificar al veterinario prescriptor (o registrar justificación de urgencia).</li>
                  <li>
                    Separar la receta física en la bandeja de sustituciones para su firma posterior por el
                    farmacéutico garante (modo POST).
                  </li>
                </ol>
              </div>
            )}
          </Tarjeta>
        </div>
      )}
    </Pagina>
  );
}
