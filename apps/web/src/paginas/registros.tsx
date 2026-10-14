import { useState } from 'react';
import { descargar, get } from '../lib/api';
import { hoyIso } from '../lib/textos';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Mensaje, Tarjeta } from '../componentes/ui';

interface Tabla {
  nombre: string;
  columnas: string[];
  filas: Array<Array<string | number>>;
}

/** Registros y exportación de salidas A/B/C, entradas y psicótropos (SPEC §4.8, §8.10). */
export function Registros() {
  const inicioMes = `${hoyIso().slice(0, 8)}01`;
  const [f, setF] = useState({ desde: inicioMes, hasta: hoyIso(), plantilla: 'A', incluirPropietario: false });
  const [tabla, setTabla] = useState<Tabla | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = (formato: string, tipo = 'salidas') => `/api/registros/${tipo}?desde=${f.desde}&hasta=${f.hasta}&plantilla=${f.plantilla}&formato=${formato}&incluirPropietario=${f.incluirPropietario ? 1 : 0}`;
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
          <Campo etiqueta="Desde" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
          <Campo etiqueta="Hasta" type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Plantilla de salidas</span>
            <select className="min-h-11 rounded-lg border px-2" value={f.plantilla} onChange={(e) => setF({ ...f, plantilla: e.target.value })}>
              <option value="A">A · Con receta</option>
              <option value="B">B · Sin receta (presencial)</option>
              <option value="C">C · Sin receta (online)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end">
            <input type="checkbox" className="h-6 w-6" checked={f.incluirPropietario} onChange={(e) => setF({ ...f, incluirPropietario: e.target.checked })} />
            Incluir datos del propietario
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Boton onClick={() => void ver('salidas')}>Ver salidas</Boton>
          <Boton variante="secundario" onClick={() => void descargar(qs('xlsx'), `salidas-${f.plantilla}-${f.desde}_${f.hasta}.xlsx`)}>
            Salidas XLSX
          </Boton>
          <Boton variante="secundario" onClick={() => void descargar(qs('csv'), `salidas-${f.plantilla}-${f.desde}_${f.hasta}.csv`)}>
            Salidas CSV
          </Boton>
          <Boton variante="secundario" onClick={() => void descargar(qs('xlsx', 'entradas'), `entradas-${f.desde}_${f.hasta}.xlsx`)}>
            Entradas XLSX
          </Boton>
          <Boton variante="secundario" onClick={() => void ver('psicotropos')}>
            Registro de psicótropos
          </Boton>
        </div>
      </Tarjeta>
      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {tabla && (
        <Tarjeta titulo={`${tabla.nombre} (${tabla.filas.length})`}>
          <div className="max-h-[60vh] overflow-auto">
            <table className="text-xs">
              <thead className="sticky top-0 bg-white">
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
    </Pagina>
  );
}
