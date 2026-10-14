import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifrado de columnas personales a nivel de aplicación (AES-256-GCM) — SPEC §6, §9.2.
 * Formato: `v1:` + base64(iv[12] | tag[16] | ciphertext). La clave (32 bytes) viene de
 * Key Vault en Azure o de COLUMN_ENCRYPTION_KEY en local.
 */
export class ColumnCipher {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) throw new Error('La clave de cifrado debe tener 32 bytes');
    this.encKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'mmx-column-enc', 32));
    this.macKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'mmx-column-mac', 32));
  }

  encrypt(plain: string): string;
  encrypt(plain: string | null | undefined): string | null;
  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
  }

  decrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!value.startsWith('v1:')) throw new Error('Formato de cifrado desconocido');
    const buf = Buffer.from(value.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  /** HMAC determinista para buscar (p. ej. por DNI) sin descifrar. */
  blindIndex(value: string | null | undefined): string | null {
    if (!value) return null;
    return createHmac('sha256', this.macKey).update(value.trim().toUpperCase()).digest('hex');
  }
}

/** Enmascara un DNI/NIE para pantalla y exportaciones internas: `****1234X` (SPEC §4.7). */
export function maskDni(dni: string | null | undefined): string | null {
  if (!dni) return null;
  const clean = dni.replace(/\s|-/g, '');
  return `****${clean.slice(-5)}`;
}
