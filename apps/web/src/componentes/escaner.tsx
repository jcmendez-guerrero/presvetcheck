import { useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, Keyboard } from 'lucide-react';
import { esRafagaLector } from '@mmx/gs1';
import { useCodigosMovil } from '../lib/movil';
import { FORMATOS_ENVASE, lector } from '../lib/zxing';
import { Boton } from './ui';

/**
 * Campo de escaneo (SPEC §4.6). Lector HID: basta el foco en el campo; una ráfaga de teclas (< 50 ms
 * entre caracteres) terminada en Intro se toma como lectura. Cámara (zxing-wasm): DataMatrix, QR,
 * EAN-13 y Code 128, cámara trasera, linterna; a los 8 s sin lectura se ofrece la entrada manual.
 */
export function CampoEscaneo({ onLectura, etiqueta = 'Escanea el envase', autoFoco = true, gsSubstitute }: { onLectura: (raw: string, metodo: 'scanner' | 'camara' | 'manual') => void; etiqueta?: string; autoFoco?: boolean; gsSubstitute?: string | null | undefined }) {
  const ref = useRef<HTMLInputElement>(null);
  const tiempos = useRef<number[]>([]);
  const [valor, setValor] = useState('');
  const [camara, setCamara] = useState(false);
  useEffect(() => {
    if (autoFoco && !camara) ref.current?.focus();
  }, [autoFoco, camara]);
  // Lecturas hechas con el móvil emparejado (llegan como lecturas de cámara).
  useCodigosMovil((raw) => onLectura(raw, 'camara'));

  const enviar = () => {
    const raw = valor;
    if (!raw.trim()) return;
    const metodo = esRafagaLector(tiempos.current) ? 'scanner' : 'manual';
    tiempos.current = [];
    setValor('');
    onLectura(raw, metodo);
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium" htmlFor="campo-escaneo">
        {etiqueta}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="campo-escaneo"
          ref={ref}
          data-testid="campo-escaneo"
          className="min-h-14 flex-1 rounded-xl border-2 border-marca px-4 font-mono text-lg"
          value={valor}
          autoComplete="off"
          placeholder={gsSubstitute ? `Lector con separador «${gsSubstitute}»` : 'Lector o código a mano'}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              enviar();
            } else if (e.key.length === 1) tiempos.current.push(performance.now());
          }}
          onChange={(e) => setValor(e.target.value)}
          // Vuelve al campo de escaneo solo si el foco no ha ido a otro campo o botón (p. ej. la entrada a mano).
          onBlur={() =>
            autoFoco &&
            !camara &&
            setTimeout(() => {
              const a = document.activeElement;
              if (!a || a === document.body) ref.current?.focus();
            }, 150)
          }
        />
        <Boton variante="secundario" onClick={() => setCamara(true)}>
          <Camera aria-hidden className="h-5 w-5" /> Cámara
        </Boton>
      </div>
      {camara && (
        <EscanerCamara
          onLectura={(raw) => {
            setCamara(false);
            onLectura(raw, 'camara');
          }}
          onCerrar={() => setCamara(false)}
        />
      )}
    </div>
  );
}

export function EscanerCamara({ onLectura, onCerrar }: { onLectura: (raw: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [linterna, setLinterna] = useState(false);
  const pista = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    let parar = false;
    let stream: MediaStream | null = null;
    const t = setTimeout(() => setManual(true), 8000);
    (async () => {
      try {
        const readBarcodes = await lector();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
        pista.current = stream.getVideoTracks()[0] ?? null;
        await pista.current?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        while (!parar) {
          const v = video.current;
          if (v && v.videoWidth) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const r = await readBarcodes(ctx.getImageData(0, 0, c.width, c.height), { formats: [...FORMATOS_ENVASE], tryHarder: true, maxNumberOfSymbols: 1 });
            const ok = r.find((x) => x.isValid);
            if (ok) {
              onLectura(ok.text);
              return;
            }
          }
          await new Promise((res) => setTimeout(res, 200));
        }
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? 'No hay permiso para usar la cámara' : 'No se puede usar la cámara en este dispositivo');
        setManual(true);
      }
    })();
    return () => {
      parar = true;
      clearTimeout(t);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, [onLectura]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-4" role="dialog" aria-label="Escanear con la cámara">
      <div className="relative w-full max-w-lg">
        <video ref={video} className="w-full rounded-2xl" playsInline muted />
        <div className="pointer-events-none absolute inset-[18%] rounded-xl border-4 border-dorado" aria-hidden />
      </div>
      {error && <p className="text-white">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <Boton
          variante="secundario"
          onClick={() => {
            const v = !linterna;
            setLinterna(v);
            void pista.current?.applyConstraints({ advanced: [{ torch: v } as MediaTrackConstraintSet] }).catch(() => {});
          }}
        >
          <Flashlight aria-hidden className="h-5 w-5" /> Linterna
        </Boton>
        {manual && (
          <Boton variante="secundario" onClick={onCerrar}>
            <Keyboard aria-hidden className="h-5 w-5" /> Introducir a mano
          </Boton>
        )}
        <Boton variante="texto" className="text-white" onClick={onCerrar}>
          Cerrar
        </Boton>
      </div>
    </div>
  );
}
