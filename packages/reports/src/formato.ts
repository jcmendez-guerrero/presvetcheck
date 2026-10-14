import ExcelJS from 'exceljs';

/** Tabla genérica para exportar (CSV o XLSX). */
export interface Tabla {
  nombre: string;
  columnas: string[];
  filas: Array<Array<string | number | null>>;
}

/** CSV para Excel en español: separador `;`, UTF-8 con BOM, CRLF. */
export function aCsv(t: Tabla): string {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[t.columnas, ...t.filas].map((r) => r.map(esc).join(';')).join('\r\n')}\r\n`;
}

/** XLSX con una hoja por tabla, cabecera en negrita y columnas autoajustadas. */
export async function aXlsx(tablas: Tabla[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mundo Mascotix · Medicamentos Veterinarios';
  wb.created = new Date(0);
  for (const t of tablas) {
    const ws = wb.addWorksheet(t.nombre.slice(0, 31));
    ws.addRow(t.columnas);
    ws.getRow(1).font = { bold: true };
    for (const f of t.filas) ws.addRow(f);
    ws.columns.forEach((c, i) => {
      const max = Math.max(t.columnas[i]?.length ?? 8, ...t.filas.map((f) => String(f[i] ?? '').length));
      c.width = Math.min(Math.max(10, max + 2), 60);
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** dd/mm/aaaa desde ISO (fecha o instante; los instantes se pasan a Europe/Madrid). */
export function fechaEs(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = typeof v === 'string' ? new Date(v) : v;
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
