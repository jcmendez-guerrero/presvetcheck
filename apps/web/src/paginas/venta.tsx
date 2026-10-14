import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { dniNieValido } from '@mmx/domain';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CN, fecha, textoMotivo, type Motivo } from '../lib/textos';
import type { Fefo } from '../lib/tipos';
import { RecordatorioTpv } from '../componentes/bandas';
import { CampoEscaneo } from '../componentes/escaner';
import { ModalForzado } from '../componentes/forzado';
import { Pagina } from '../componentes/layout';
import { Boton, Campo, Mensaje, Tarjeta } from '../componentes/ui';
import { ListaEnvases, useEnvases } from './dispensacion';
import type { CodigoIncidencia } from '@mmx/shared';

interface Comprobacion {
  presentacion: { cn: string; nombre: string };
  medicamento: { nombre: string; receta: boolean; especies: string[] };
  incidencias: Motivo[];
  permitido: boolean;
  propuesta: Fefo | null;
}

/** Venta sin receta y pedido online (SPEC §4.7, §8.7). */
export function Venta() {
  const { canal } = useSearch({ from: '/venta' });
  const { usuario } = useAuth();
  const [cn, setCn] = useState('');
  const [comp, setComp] = useState<Comprobacion | null>(null);
  const [prop, setProp] = useState({ nombre: '', movil: '', direccion: '', dni: '' });
  const [especie, setEspecie] = useState('');
  const [ref, setRef] = useState('');
  const [motivoLote, setMotivoLote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [hecho, setHecho] = useState<{ cn: string; lote: string; unidades: number }[] | null>(null);
  const [modal, setModal] = useState<CodigoIncidencia[] | null>(null);
  const { envases, setEnvases, leer, error, gs } = useEnvases();

  const comprobar = async (c: string) => {
    setMsg(null);
    try {
      setComp(await get<Comprobacion>(`/api/venta/comprobar?cn=${c}&canal=${canal}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };
  const dniMal = prop.dni !== '' && !dniNieValido(prop.dni);
  const online = canal === 'online';
  const faltanDatos = online && (!prop.nombre || !prop.movil || !prop.direccion || !prop.dni || dniMal);
  const recomendado = comp?.propuesta?.recomendado?.lote ?? null;
  const loteDistinto = recomendado !== null && envases.some((e) => e.lote && e.lote !== recomendado);

  const enviar = async (forzado: { codigos: CodigoIncidencia[]; motivo: string; aceptaRiesgos: boolean } | null) => {
    try {
      const r = await post<{ recordatorioTpv: { cn: string; lote: string; unidades: number }[] }>('/api/dispensaciones', {
        conReceta: false,
        canal,
        cn: comp!.presentacion.cn,
        envases,
        motivoLoteDistinto: loteDistinto ? motivoLote : null,
        forzado,
        especie: especie || null,
        propietario: online || Object.values(prop).some(Boolean) ? { nombre: prop.nombre || null, movil: prop.movil || null, direccion: prop.direccion || null, dni: prop.dni || null } : null,
        referenciaPedido: ref || null,
      });
      setHecho(r.recordatorioTpv);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.detalles?.forzables)) setModal(e.detalles.forzables as CodigoIncidencia[]);
      else setMsg(e instanceof ApiError ? e.message : 'Error');
    }
  };

  if (hecho)
    return (
      <Pagina titulo="Venta registrada">
        <RecordatorioTpv items={hecho} />
      </Pagina>
    );

  return (
    <Pagina titulo={online ? 'Pedido online' : 'Venta sin receta'}>
      <Tarjeta titulo="1. Medicamento">
        <CampoEscaneo
          etiqueta="Escanea el envase o escribe el código nacional"
          gsSubstitute={gs}
          onLectura={async (raw, m) => {
            const r = await post<{ ok: boolean; cn: string | null }>('/api/scan/parse', { raw }).catch(() => null);
            const c = r?.ok && r.cn ? r.cn : /^\d{6}$/.test(raw.trim()) ? raw.trim() : null;
            if (!c) return setMsg('No se reconoce el código nacional');
            setCn(c);
            await comprobar(c);
            if (r?.ok) void leer(raw, m);
          }}
        />
        <div className="mt-2 flex gap-2">
          <Campo etiqueta={CN} value={cn} onChange={(e) => setCn(e.target.value)} />
          <Boton variante="secundario" className="self-end" onClick={() => void comprobar(cn)}>
            Comprobar
          </Boton>
        </div>
        {comp && (
          <div className="mt-3">
            <p className="font-semibold">{comp.presentacion.nombre}</p>
            {comp.incidencias.map((i) => (
              <Mensaje key={i.code} tipo="error">
                {textoMotivo(i).titulo}. {textoMotivo(i).accion}
              </Mensaje>
            ))}
            {comp.permitido && recomendado && (
              <p className="mt-2">
                Lote recomendado: <strong className="font-mono text-2xl">{recomendado}</strong> (caduca el {fecha(comp.propuesta?.recomendado?.caducidad)})
              </p>
            )}
          </div>
        )}
      </Tarjeta>
      {comp?.permitido && (
        <>
          <Tarjeta titulo="2. Envase">
            {error && <Mensaje tipo="error">{error}</Mensaje>}
            <Boton variante="texto" onClick={() => setEnvases((e) => [...e, { lote: '', caducidad: null, unidades: 1, gtin: null, cnEscaneado: comp.presentacion.cn, serie: null, metodoCaptura: 'manual' }])}>
              Añadir envase a mano
            </Boton>
            <ListaEnvases envases={envases} setEnvases={setEnvases} recomendado={recomendado} />
            {loteDistinto && <Campo etiqueta="Motivo para no dispensar el lote recomendado" value={motivoLote} onChange={(e) => setMotivoLote(e.target.value)} />}
            <Campo etiqueta={`Especie (si no se indica: ${comp.medicamento.especies.join(', ')})`} value={especie} onChange={(e) => setEspecie(e.target.value)} />
          </Tarjeta>
          <Tarjeta titulo={online ? '3. Datos del propietario (obligatorios)' : '3. Datos del propietario (opcionales)'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre" value={prop.nombre} onChange={(e) => setProp({ ...prop, nombre: e.target.value })} />
              <Campo etiqueta="Móvil" value={prop.movil} onChange={(e) => setProp({ ...prop, movil: e.target.value })} />
              <Campo etiqueta="Dirección de entrega" value={prop.direccion} onChange={(e) => setProp({ ...prop, direccion: e.target.value })} />
              <Campo etiqueta="DNI / NIE" value={prop.dni} onChange={(e) => setProp({ ...prop, dni: e.target.value })} ayuda={dniMal ? 'La letra no es correcta' : undefined} />
              {online && <Campo etiqueta="Referencia del pedido" value={ref} onChange={(e) => setRef(e.target.value)} />}
            </div>
          </Tarjeta>
          {msg && <Mensaje tipo="error">{msg}</Mensaje>}
          <Boton disabled={!envases.length || faltanDatos} onClick={() => void enviar(null)}>
            Confirmar venta
          </Boton>
        </>
      )}
      {!comp?.permitido && msg && <Mensaje tipo="error">{msg}</Mensaje>}
      {modal && <ModalForzado codigos={modal} usuario={usuario?.nombre ?? ''} onCancelar={() => setModal(null)} onConfirmar={(f) => { setModal(null); void enviar(f); }} />}
    </Pagina>
  );
}
