/**
 * Utilidad robusta para copiar texto al portapapeles con fallback seguro
 * para navegadores antiguos, entornos sin HTTPS o restricciones de iframe.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (!texto) return false;

  // Intento primario mediante Clipboard API moderna
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Si falla por permisos o foco, pasar al fallback
    }
  }

  // Fallback mediante selección de elemento de texto
  try {
    const el = document.createElement('textarea');
    el.value = texto;
    el.setAttribute('readonly', '');
    el.style.position = 'absolute';
    el.style.left = '-9999px';
    el.style.top = '0';
    document.body.appendChild(el);
    el.select();
    const exito = document.execCommand('copy');
    document.body.removeChild(el);
    return exito;
  } catch {
    return false;
  }
}
