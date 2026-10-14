/** Sonido distinto para escaneo correcto e incorrecto (SPEC §8). */
let ctx: AudioContext | null = null;
export function pitido(ok: boolean) {
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
  } catch {
    /* sin audio */
  }
}
