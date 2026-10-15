import { useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { enlaceMovil, useMovil } from '../lib/movil';
import { qrSvg } from '../lib/zxing';
import { Boton, Mensaje } from './ui';

/** Botón de la cabecera: empareja un móvil con este PC mediante un código QR. */
export function BotonMovil() {
  const m = useMovil();
  const [abierto, setAbierto] = useState(false);
  if (!m) return null;
  return (
    <>
      <button
        type="button"
        data-testid="boton-movil"
        className="flex items-center gap-1 rounded-lg px-3 py-2 hover:bg-marca-2"
        onClick={() => setAbierto(true)}
        title={m.conectado ? 'Móvil conectado' : 'Usar el móvil para fotos y códigos'}
      >
        <Smartphone aria-hidden className="h-5 w-5" />
        Móvil
        {m.sesion && <span aria-label={m.conectado ? 'conectado' : 'esperando'} className={`h-2.5 w-2.5 rounded-full ${m.conectado ? 'bg-green-400' : 'bg-dorado'}`} />}
      </button>
      {abierto && <DialogoMovil onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function DialogoMovil({ onCerrar }: { onCerrar: () => void }) {
  const m = useMovil()!;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sesion, abrir, conectado } = m;
  // Cuando el móvil se conecta mientras se muestra el QR, el diálogo sobra: se cierra solo.
  const yaConectado = useRef(conectado);
  useEffect(() => {
    if (!conectado || yaConectado.current) return;
    const t = setTimeout(onCerrar, 1500);
    return () => clearTimeout(t);
  }, [conectado, onCerrar]);

  useEffect(() => {
    if (!sesion) void abrir().catch(() => setError('No se ha podido preparar el emparejamiento'));
  }, [sesion, abrir]);
  useEffect(() => {
    if (sesion) void qrSvg(enlaceMovil(sesion)).then(setSvg, () => setError('No se ha podido generar el código QR'));
  }, [sesion]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 text-texto" role="dialog" aria-label="Usar el móvil">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-6">
        <h2 className="text-2xl font-bold">Usar el móvil</h2>
        <p className="text-slate-700">Lee este código con la cámara del móvil. Desde el móvil podrás fotografiar recetas y leer los códigos de los envases; todo llega a esta pantalla.</p>
        {svg && sesion ? (
          <>
            <div className="mx-auto w-64 [&>svg]:h-auto [&>svg]:w-full" data-testid="qr-movil" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="break-all text-center text-xs text-slate-500">{enlaceMovil(sesion).replace(/#.*/, '')}</p>
            <p className={`text-center font-semibold ${m.conectado ? 'text-green-700' : 'text-slate-600'}`}>{m.conectado ? 'Móvil conectado' : 'Esperando al móvil…'}</p>
            <p className="text-center text-sm text-slate-500">Válido hasta las {new Date(sesion.expiraAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}. No compartas este código.</p>
          </>
        ) : (
          !error && <p className="animate-pulse text-center">Preparando el código…</p>
        )}
        {error && <Mensaje tipo="error">{error}</Mensaje>}
        <div className="flex flex-wrap justify-end gap-3">
          {sesion && (
            <Boton
              variante="secundario"
              onClick={() => {
                void m.cerrar();
                onCerrar();
              }}
            >
              Desconectar el móvil
            </Boton>
          )}
          <Boton onClick={onCerrar}>Cerrar</Boton>
        </div>
      </div>
    </div>
  );
}

/** Avisos en el PC de lo que llega del móvil. */
export function AvisosMovil() {
  const m = useMovil();
  if (!m) return null;
  return (
    <>
      {m.leyendo && <p className="animate-pulse bg-acento px-4 py-1 text-center text-sm font-semibold text-texto">Leyendo la receta enviada desde el móvil…</p>}
      {m.codigoSinDestino && (
        <p className="bg-acento px-4 py-1 text-center text-sm font-semibold text-texto">
          Código recibido del móvil ({m.codigoSinDestino.slice(0, 30)}): abre una dispensación o una recepción para usarlo
        </p>
      )}
    </>
  );
}
