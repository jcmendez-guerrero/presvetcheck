/** Validación de DNI y NIE con letra de control (SPEC §4.7, D-07). */
const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function normalizarDni(v: string): string {
  return v.replace(/[\s.-]/g, '').toUpperCase();
}

export function dniNieValido(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = normalizarDni(v);
  let num: string;
  const dni = /^(\d{8})([A-Z])$/.exec(s);
  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(s);
  if (dni) num = dni[1] as string;
  else if (nie) num = String('XYZ'.indexOf(nie[1] as string)) + (nie[2] as string);
  else return false;
  const letra = s.slice(-1);
  return LETRAS[Number(num) % 23] === letra;
}
