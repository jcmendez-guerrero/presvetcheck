import type { DepsHerramientas } from './contexto';
import { herramientaBuscarAyuda, herramientaBuscarGuia } from './fuentes';
import { herramientaConsultarReglas } from './reglas';
import { ToolRegistry } from './registry';
import { herramientaBuscarMedicamento, herramientaFichaMedicamento } from './cimavet';
import { herramientaContextoLinea } from './linea';
import { herramientaSimularSustituibilidad, herramientaSimularValidez } from './simulaciones';
import { herramientaSimularCambioFormato, herramientaSimularEquivalencia } from './simulaciones-medicamento';

export * from './contexto';
export * from './registry';
export { versionDeRegla } from './reglas';
export { resultadoSimulacion } from './simulaciones';

/** Registro con todas las herramientas del asistente (todas de solo lectura). */
export function crearHerramientas(d: DepsHerramientas): ToolRegistry {
  return new ToolRegistry([
    herramientaConsultarReglas(d) as never,
    herramientaBuscarGuia(d) as never,
    herramientaBuscarAyuda(d) as never,
    herramientaSimularValidez(d) as never,
    herramientaSimularSustituibilidad(d) as never,
    herramientaSimularCambioFormato(d) as never,
    herramientaSimularEquivalencia(d) as never,
    herramientaBuscarMedicamento(d) as never,
    herramientaFichaMedicamento(d) as never,
    herramientaContextoLinea(d) as never,
  ]);
}
