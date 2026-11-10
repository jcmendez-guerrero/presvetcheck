import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, descargar, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { hoyIso } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Etiqueta, Mensaje, Tarjeta } from '../componentes/ui';

interface Tabla {
  nombre: string;
  columnas: string[];
  filas: Array<Array<string | number>>;
}

/** Registros y exportación de salidas A/B/C, entradas y psicótropos (SPEC §4.8, §8.10). */
export function Registros() {
  const inicioMes = `${hoyIso().slice(0, 8)}01`;
  const [f, setF] = useState({
    desde: inicioMes,
    hasta: hoyIso(),
    plantilla: 'A',
    incluirPropietario: false,
  });
  const [tabla, setTabla] = useState<Tabla | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = (formato: string, tipo = 'salidas') =>
    `/api/registros/${tipo}?desde=${f.desde}&hasta=${f.hasta}&plantilla=${f.plantilla}&formato=${formato}&incluirPropietario=${f.incluirPropietario ? 1 : 0}`;
  const ver = async (tipo: string) => {
    setError(null);
    try {
      setTabla((await get<{ tablas: Tabla[] }>(qs('json', tipo))).tablas[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Pagina titulo="Registros y reportes">
      <Tarjeta>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo
            etiqueta="Desde"
            type="date"
            value={f.desde}
            onChange={(e) => setF({ ...f, desde: e.target.value })}
          />
          <Campo
            etiqueta="Hasta"
            type="date"
            value={f.hasta}
            onChange={(e) => setF({ ...f, hasta: e.target.value })}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Plantilla de salidas</span>
            <select
              className="min-h-11 rounded-lg border px-2"
              value={f.plantilla}
              onChange={(e) => setF({ ...f, plantilla: e.target.value })}
            >
              <option value="A">A · Con receta</option>
              <option value="B">B · Sin receta (presencial)</option>
              <option value="C">C · Sin receta (online)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              className="h-6 w-6"
              checked={f.incluirPropietario}
              onChange={(e) => setF({ ...f, incluirPropietario: e.target.checked })}
            />
            Incluir datos del propietario (en todas las exportaciones de salidas; DNI enmascarado)
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Boton onClick={() => void ver('salidas')}>Ver salidas</Boton>
          <Boton
            variante="secundario"
            onClick={() => void descargar(qs('xlsx'), `salidas-${f.plantilla}-${f.desde}_${f.hasta}.xlsx`)}
          >
            Salidas XLSX
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => void descargar(qs('csv'), `salidas-${f.plantilla}-${f.desde}_${f.hasta}.csv`)}
          >
            Salidas CSV
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => void descargar(qs('xlsx', 'entradas'), `entradas-${f.desde}_${f.hasta}.xlsx`)}
          >
            Entradas XLSX
          </Boton>
          <Boton variante="secundario" onClick={() => void ver('entradas')}>
            Ver entradas
          </Boton>
          <Boton variante="secundario" onClick={() => void ver('psicotropos')}>
            Registro de psicótropos
          </Boton>
          <Boton variante="secundario" onClick={() => void ver('bajas')}>
            Registro de bajas
          </Boton>
          <Boton
            variante="secundario"
            onClick={() => void descargar(qs('xlsx', 'bajas'), `bajas-${f.desde}_${f.hasta}.xlsx`)}
          >
            Bajas XLSX
          </Boton>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Informes de conjunto">
        <p className="mb-3 text-sm text-slate-700">
          Para el periodo elegido arriba. Llevan los datos del propietario si marcas «Incluir datos del
          propietario».
        </p>
        <div className="flex flex-wrap gap-3">
          <Boton onClick={() => void ver('todas-salidas')}>Todas las salidas</Boton>
          <Boton
            variante="secundario"
            onClick={() =>
              void descargar(qs('xlsx', 'todas-salidas'), `todas-las-salidas-${f.desde}_${f.hasta}.xlsx`)
            }
          >
            Todas las salidas XLSX
          </Boton>
          <Boton onClick={() => void ver('movimientos')}>Ver entradas y salidas</Boton>
          <Boton
            variante="secundario"
            onClick={() =>
              void descargar(qs('xlsx', 'movimientos'), `entradas-y-salidas-${f.desde}_${f.hasta}.xlsx`)
            }
          >
            Entradas y salidas XLSX (una hoja para cada una)
          </Boton>
        </div>
      </Tarjeta>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {tabla && (
        <Tarjeta titulo={`${tabla.nombre} (${tabla.filas.length})`}>
          <div className="max-h-[60vh] overflow-auto">
            <table className="text-xs">
              <thead className="sticky top-0 bg-superficie border-b border-borde text-texto">
                <tr>
                  {tabla.columnas.map((c) => (
                    <th key={c} className="whitespace-nowrap p-1 text-left">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabla.filas.map((fila, i) => (
                  <tr key={i} className="border-t">
                    {fila.map((v, j) => (
                      <td key={j} className="whitespace-nowrap p-1">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}
      <ImportarAnteriores />
    </Pagina>
  );
}

/** Cabeceras de las plantillas de importación (las mismas que exporta la app). */
const PLANTILLAS = {
  entradas: [
    'FECHA COMPRA',
    'FECHA RECEPCIÓN',
    'NOMBRE DEL FÁRMACO',
    'PRINCIPIO ACTIVO',
    'FORMA FARMACÉUTICA',
    'CÓDIGO NACIONAL',
    'LOTE',
    'CADUCIDAD',
    'UNIDADES',
    'DISTRIBUIDOR',
    'Nº ALBARÁN',
    'PRECIO NETO COMPRA (sin IVA ni RE)',
    'IVA %',
  ],
  salidas: [
    'FECHA',
    'TIPO DE SALIDA',
    'NOMBRE DEL FÁRMACO',
    'PRINCIPIO ACTIVO',
    'FORMA FARMACÉUTICA',
    'ESPECIE',
    'CÓDIGO NACIONAL',
    'LOTE',
    'CADUCIDAD',
    'UNIDADES DISPENSADAS',
    'Nº RECETA',
    'FECHA RECETA',
    'VETERINARIO',
    'Nº COLEGIADO',
    'DIRECCIÓN VETERINARIO',
    'NOMBRE CLÍNICA',
    'NOMBRE PROPIETARIO',
    'MÓVIL',
    'DNI',
    'DIRECCIÓN',
  ],
};

interface VistaPrevia {
  reconocidas: string[];
  ignoradas: string[];
  validas: number;
  totalErrores: number;
  errores: { fila: number; mensajes: string[] }[];
  totalAvisos: number;
  avisos: { fila: number; mensajes: string[] }[];
  totalOmitidas: number;
  omitidas: { fila: number; nombre: string }[];
}
interface Importacion {
  id: string;
  tipo: string;
  fichero: string;
  filas: number;
  createdAt: string;
  anuladaAt: string | null;
  motivoAnulacion: string | null;
}

/**
 * Importar entradas y salidas llevadas antes de la app (Excel o CSV con las mismas columnas que exporta). Primero
 * se analiza (errores por fila) y luego se importa; una importación equivocada se anula (no se borra).
 */
function ImportarAnteriores() {
  const { tiene } = useAuth();
  const qc = useQueryClient();
  const puede = tiene('veterinaria_responsable', 'admin');
  const lista = useQuery({
    queryKey: ['importaciones'],
    queryFn: () => get<Importacion[]>('/api/importaciones'),
    enabled: puede,
  });
  const [tipo, setTipo] = useState<'entradas' | 'salidas'>('entradas');
  const [plantilla, setPlantilla] = useState('');
  const [fichero, setFichero] = useState<File | null>(null);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [msg, setMsg] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!puede) return null;

  const enviar = async (url: string) => {
    if (!fichero) return null;
    const fd = new FormData();
    fd.append('tipo', tipo);
    if (tipo === 'salidas' && plantilla) fd.append('plantilla', plantilla);
    fd.append('fichero', fichero, fichero.name);
    return post<unknown>(url, fd);
  };
  const analizar = async () => {
    setMsg(null);
    setOcupado(true);
    try {
      setVista((await enviar('/api/importaciones/vista-previa')) as VistaPrevia);
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'No se ha podido analizar el fichero' });
    } finally {
      setOcupado(false);
    }
  };
  const importar = async () => {
    setOcupado(true);
    try {
      const r = (await enviar('/api/importaciones')) as { filas: number; omitidas: number };
      setMsg({
        t: 'ok',
        m: `Importados ${r.filas} medicamento(s)${r.omitidas ? ` (${r.omitidas} fila(s) omitidas por no ser medicamentos)` : ''}. Ya aparecen en los registros e informes como «importado».`,
      });
      setVista(null);
      setFichero(null);
      await qc.invalidateQueries({ queryKey: ['importaciones'] });
    } catch (e) {
      setMsg({ t: 'error', m: e instanceof ApiError ? e.message : 'No se ha podido importar' });
    } finally {
      setOcupado(false);
    }
  };
  const plantillaCsv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([`\uFEFF${PLANTILLAS[tipo].join(';')}\r\n`], { type: 'text/csv;charset=utf-8' }),
    );
    a.download = `plantilla-${tipo}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  return (
    <Tarjeta titulo="Importar datos anteriores">
      <p className="mb-3 text-sm text-slate-700">
        Para incorporar las entradas y salidas que llevabais antes de la app. Usa un Excel (.xlsx) o CSV con
        las mismas columnas que exporta la app (en cualquier orden). Primero se analiza: cada fila se valida
        contra CIMAVet y se enseñan los errores fila a fila; solo se importa si no hay ninguno. Las filas que
        no son medicamentos se omiten.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <Etiqueta
            texto="Qué contiene"
            info="Entradas (compras a proveedores) o salidas (dispensaciones y ventas). Van por separado."
          />
          <select
            className="min-h-11 rounded-lg border px-2"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as 'entradas' | 'salidas');
              setVista(null);
            }}
          >
            <option value="entradas">Entradas</option>
            <option value="salidas">Salidas</option>
          </select>
        </label>
        {tipo === 'salidas' && (
          <label className="flex flex-col gap-1 text-sm">
            <Etiqueta
              texto="Plantilla de las salidas"
              info="Si el fichero tiene la columna «TIPO DE SALIDA» (como el informe «Todas las salidas»), se toma de ahí. Si no, indica cuál es."
            />
            <select
              className="min-h-11 rounded-lg border border-borde bg-superficie px-3 text-texto"
              value={plantilla}
              onChange={(e) => setPlantilla(e.target.value)}
            >
              <option value="">Viene en el fichero (TIPO DE SALIDA)</option>
              <option value="A">A · Con receta</option>
              <option value="B">B · Sin receta (presencial)</option>
              <option value="C">C · Sin receta (online)</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <Etiqueta
            texto="Fichero"
            info="Excel (.xlsx, primera hoja) o CSV separado por punto y coma o coma. Fechas como 14/03/2025 e importes como 12,50."
          />
          <input
            type="file"
            accept=".xlsx,.csv"
            className="min-h-11 rounded-lg border border-borde bg-superficie px-3 py-2 text-texto cursor-pointer"
            onChange={(e) => {
              setFichero(e.target.files?.[0] ?? null);
              setVista(null);
              setMsg(null);
            }}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Boton disabled={!fichero || ocupado} onClick={() => void analizar()}>
          Analizar el fichero
        </Boton>
        <Boton variante="secundario" onClick={plantillaCsv}>
          Descargar plantilla de {tipo}
        </Boton>
      </div>
      {vista && (
        <div className="mt-3 flex flex-col gap-2" data-testid="vista-importacion">
          <p className="text-sm">
            Columnas reconocidas: {vista.reconocidas.length} · ignoradas:{' '}
            {vista.ignoradas.length ? vista.ignoradas.join(', ') : 'ninguna'}
          </p>
          {vista.totalErrores > 0 ? (
            <Mensaje tipo="error">
              {vista.totalErrores} fila(s) con errores (corrígelas en el fichero y vuelve a analizarlo):
              <ul className="mt-1 list-disc pl-5">
                {vista.errores.slice(0, 30).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.mensajes.join(' · ')}
                  </li>
                ))}
              </ul>
            </Mensaje>
          ) : (
            <Mensaje tipo="ok">
              Sin errores: {vista.validas} medicamento(s) validados en CIMAVet, listos para importar.
            </Mensaje>
          )}
          {vista.totalOmitidas > 0 && (
            <Mensaje tipo="info">
              {vista.totalOmitidas} fila(s) no son medicamentos (no están en CIMAVet) y no se importan: el
              registro de entradas y salidas solo es obligatorio para medicamentos.
              <ul className="mt-1 list-disc pl-5">
                {vista.omitidas.slice(0, 15).map((o) => (
                  <li key={o.fila}>
                    Fila {o.fila}: {o.nombre}
                  </li>
                ))}
              </ul>
            </Mensaje>
          )}
          {vista.totalAvisos > 0 && (
            <Mensaje tipo="aviso">
              {vista.totalAvisos} aviso(s) (se pueden importar, pero revísalos):
              <ul className="mt-1 list-disc pl-5">
                {vista.avisos.slice(0, 30).map((e) => (
                  <li key={e.fila}>
                    Fila {e.fila}: {e.mensajes.join(' · ')}
                  </li>
                ))}
              </ul>
            </Mensaje>
          )}
          <Boton
            disabled={ocupado || vista.totalErrores > 0 || vista.validas === 0}
            onClick={() => void importar()}
          >
            Importar {vista.validas} fila(s)
          </Boton>
        </div>
      )}
      {msg && <Mensaje tipo={msg.t}>{msg.m}</Mensaje>}
      {(lista.data?.length ?? 0) > 0 && (
        <div className="mt-4">
          <p className="font-semibold">Importaciones</p>
          <ul className="divide-y text-sm">
            {lista.data!.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {new Date(x.createdAt).toLocaleDateString('es-ES')} · {x.tipo} · {x.fichero} · {x.filas}{' '}
                  filas
                  {x.anuladaAt && (
                    <strong className="ml-2 text-noconforme">Anulada: {x.motivoAnulacion}</strong>
                  )}
                </span>
                {!x.anuladaAt && (
                  <Boton
                    variante="texto"
                    onClick={async () => {
                      const motivo = window.prompt(
                        'Motivo de la anulación (las filas dejarán de contar en los registros; no se borran):',
                      );
                      if (!motivo) return;
                      try {
                        await post(`/api/importaciones/${x.id}/anular`, { motivo });
                        await qc.invalidateQueries({ queryKey: ['importaciones'] });
                      } catch (e) {
                        setMsg({
                          t: 'error',
                          m: e instanceof ApiError ? e.message : 'No se ha podido anular',
                        });
                      }
                    }}
                  >
                    Anular
                  </Boton>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  );
}
