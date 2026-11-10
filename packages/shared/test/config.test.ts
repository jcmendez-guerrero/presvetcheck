import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const base = {
  DATABASE_URL: 'postgres://x',
  BLOB_CONNECTION_STRING: 'UseDevelopmentStorage=true',
  AUTH_MODE: 'dev',
};

describe('loadConfig', () => {
  it('aplica los valores por defecto documentados', () => {
    const c = loadConfig(base);
    expect(c.SIWEB_STOCK_WRITE_MODE).toBe('off');
    expect(c.SUBSTITUTION_APPROVAL_MODE).toBe('POST');
    expect(c.PRODUCT_VALIDITY_HARD_BLOCK).toBe(false);
    expect(c.PSYCHOTROPIC_ALLOW_FORCE).toBe(false);
    expect(c.ALLOW_PARTIAL_DISPENSATION).toBe(true);
    expect(c.EXTRACTION_CONFIDENCE_THRESHOLD).toBe(0.85);
    expect(c.SIWEB_WAREHOUSE_NAME).toBe('Farmacia');
    expect(c.SIWEB_SKU_CN_REGEX).toBe('CN(\\d{6,7})$');
    expect(c.EXTRACTOR).toBe('fake');
    expect(c.CIMAVET_RPS).toBe(3);
    expect(c.MANUAL_PRESCRIPTION_ENTRY).toBe('disabled');
  });

  it('prohíbe AUTH_MODE=dev en producción', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_MODE=dev está prohibido/);
  });

  it('en producción exige las variables obligatorias y rechaza secretos en claro', () => {
    try {
      loadConfig({
        DATABASE_URL: 'postgres://x',
        NODE_ENV: 'production',
        AUTH_MODE: 'entra',
        SIWEB_TOKEN: 'abc',
      });
      expect.fail('debería lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).issues.join('\n');
      expect(msg).toMatch(/ENTRA_TENANT_ID/);
      expect(msg).toMatch(/BLOB_ACCOUNT_URL/);
      expect(msg).toMatch(/KEY_VAULT_URL/);
      expect(msg).toMatch(/EXTRACTOR=fake no se admite/);
      expect(msg).toMatch(/SIWEB_TOKEN solo se admite en local/);
    }
  });

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({ AUTH_MODE: 'dev' })).toThrow(/DATABASE_URL/);
  });

  it('EXTRACTOR=azure sin configuración: desactivado en local, error en producción', () => {
    expect(loadConfig({ ...base, EXTRACTOR: 'azure' }).EXTRACTOR).toBe('azure');
    expect(() =>
      loadConfig({
        DATABASE_URL: 'x',
        NODE_ENV: 'production',
        AUTH_MODE: 'entra',
        ENTRA_TENANT_ID: 't',
        ENTRA_CLIENT_ID: 'c',
        BLOB_ACCOUNT_URL: 'https://b',
        KEY_VAULT_URL: 'https://k',
        EXTRACTOR: 'azure',
      }),
    ).toThrow(/DOCINTEL_ENDPOINT/);
  });

  it('valida la clave de cifrado, el regex y el sustituto de GS', () => {
    expect(() => loadConfig({ ...base, COLUMN_ENCRYPTION_KEY: 'corta' })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, SIWEB_SKU_CN_REGEX: '(' })).toThrow(/Expresión regular/);
    expect(() => loadConfig({ ...base, SCANNER_GS_SUBSTITUTE: '~~' })).toThrow(/único carácter/);
    expect(loadConfig({ ...base, SCANNER_GS_SUBSTITUTE: '~' }).SCANNER_GS_SUBSTITUTE).toBe('~');
  });

  it('interpreta booleanos y números', () => {
    const c = loadConfig({
      ...base,
      PRODUCT_VALIDITY_HARD_BLOCK: 'true',
      SIWEB_WAREHOUSE_ID: '14',
      CIMAVET_RPS: '2',
    });
    expect(c.PRODUCT_VALIDITY_HARD_BLOCK).toBe(true);
    expect(c.SIWEB_WAREHOUSE_ID).toBe(14);
    expect(c.CIMAVET_RPS).toBe(2);
    expect(() => loadConfig({ ...base, CIMAVET_RPS: 'x' })).toThrow(/no es un número/);
  });
});
