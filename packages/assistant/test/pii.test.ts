import { describe, expect, it } from 'vitest';
import { limpiarDatosPersonales, MARCA_DATO_ELIMINADO as M } from '../src/pii';

describe('limpiarDatosPersonales', () => {
  it.each([
    ['DNI válido', 'El DNI es 12345678Z y quiere el medicamento', /12345678/],
    ['DNI con letra incorrecta', 'dni 12345678A', /12345678/],
    ['DNI con puntos y guion', 'su dni: 12.345.678-Z', /12\.345/],
    ['NIE', 'NIE X1234567L del cliente', /X1234567/],
    ['teléfono', 'llama al 612345678 si hace falta', /612345678/],
    ['teléfono con prefijo y grupos 3-2-2-2', 'tel +34 612 34 56 78', /612/],
    ['teléfono con espacios', 'tel 612 345 678', /612/],
    ['correo', 'escribe a juan.perez@example.com ya', /@/],
    ['dirección', 'vive en C/ Mayor 12 de Madrid', /Mayor/],
  ])('%s', (_n, entrada, noDebeQuedar) => {
    const r = limpiarDatosPersonales(entrada);
    expect(r.eliminada).toBe(true);
    expect(r.texto).toContain(M);
    expect(r.texto).not.toMatch(noDebeQuedar);
  });

  it.each([
    '¿Cuántos días vale una receta con antibiótico?',
    'Receta del 3 de octubre, 2 cajas de 250 mg x 10 comprimidos',
    'El código nacional 570016 y el registro 1868 ESP',
    '¿Y si son 15 animales y 500 mg por kilo?',
  ])('no toca texto sin datos personales: %s', (entrada) => {
    expect(limpiarDatosPersonales(entrada)).toEqual({ texto: entrada, eliminada: false });
  });

  it('elimina nombre y teléfono conocidos sin distinguir mayúsculas ni acentos', () => {
    const r = limpiarDatosPersonales('La clienta MARÍA lópez-ruiz vino con el 612-345-678', [
      'María López-Ruiz',
      '612 345 678',
    ]);
    expect(r.eliminada).toBe(true);
    expect(r.texto).not.toMatch(/mar[ií]a|l[oó]pez|612/i);
  });

  it('elimina un apellido suelto de un dato conocido', () => {
    const r = limpiarDatosPersonales('¿Qué le digo al señor Pérez?', ['Juan Pérez García']);
    expect(r.eliminada).toBe(true);
    expect(r.texto).not.toContain('Pérez');
  });

  it('no elimina palabras que solo contienen un dato conocido', () => {
    const r = limpiarDatosPersonales('Perezoso no es un dato', ['Pérez']);
    expect(r.eliminada).toBe(false);
  });
});

describe('palabras comunes dentro de valores conocidos', () => {
  it('no borra «veterinario» pero sí el apellido que lo acompaña', () => {
    const r = limpiarDatosPersonales('El veterinario prescriptor es Ruiz Palomo.', ['Veterinario Ruiz Palomo']);
    expect(r.texto).toContain('El veterinario prescriptor');
    expect(r.texto).not.toContain('Ruiz');
    expect(r.texto).not.toContain('Palomo');
  });
});
