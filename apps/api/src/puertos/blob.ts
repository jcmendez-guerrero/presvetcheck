import { createHash } from 'node:crypto';
import type { BlobServiceClient } from '@azure/storage-blob';

/** Almacén de ficheros (imágenes de recetas, reportes). Azure Blob con inmutabilidad en producción. */
export interface BlobStore {
  put(contenedor: 'recetas' | 'reportes', path: string, bytes: Uint8Array, mime: string): Promise<string>;
  get(contenedor: 'recetas' | 'reportes', path: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
}

export class MemoryBlobStore implements BlobStore {
  private readonly m = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(c: string, path: string, bytes: Uint8Array, mime: string) {
    this.m.set(`${c}/${path}`, { bytes, mime });
    return `${c}/${path}`;
  }
  async get(c: string, path: string) {
    return this.m.get(`${c}/${path}`) ?? null;
  }
}

/**
 * Azure Blob Storage: Azurite con cadena de conexión en local; identidad gestionada con la URL de la
 * cuenta en Azure (sin claves). Los contenedores tienen inmutabilidad temporal (infra/).
 */
export class AzureBlobStore implements BlobStore {
  private constructor(private readonly svc: BlobServiceClient) {}

  static async crear(cfg: { connectionString?: string | undefined; accountUrl?: string | undefined }): Promise<AzureBlobStore> {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    let svc;
    if (cfg.accountUrl) {
      const { DefaultAzureCredential } = await import('@azure/identity');
      svc = new BlobServiceClient(cfg.accountUrl, new DefaultAzureCredential());
    } else if (cfg.connectionString) {
      svc = BlobServiceClient.fromConnectionString(cfg.connectionString);
      // Solo en local (Azurite): crea los contenedores si no existen.
      for (const c of ['recetas', 'reportes']) await svc.getContainerClient(c).createIfNotExists();
    } else throw new Error('Sin configuración de Blob Storage');
    return new AzureBlobStore(svc);
  }

  async put(c: 'recetas' | 'reportes', path: string, bytes: Uint8Array, mime: string) {
    const blob = this.svc.getContainerClient(c).getBlockBlobClient(path);
    await blob.uploadData(Buffer.from(bytes), { blobHTTPHeaders: { blobContentType: mime } });
    return `${c}/${path}`;
  }

  async get(c: 'recetas' | 'reportes', path: string) {
    const blob = this.svc.getContainerClient(c).getBlockBlobClient(path);
    if (!(await blob.exists())) return null;
    const buf = await blob.downloadToBuffer();
    const props = await blob.getProperties();
    return { bytes: new Uint8Array(buf), mime: props.contentType ?? 'application/octet-stream' };
  }
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
