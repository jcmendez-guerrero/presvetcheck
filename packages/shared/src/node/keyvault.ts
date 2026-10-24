/** Lee un secreto de Key Vault con identidad gestionada (sin claves en la configuración, ADR-07). */
export async function secretoKeyVault(url: string, nombre: string): Promise<string> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const token = await new DefaultAzureCredential().getToken('https://vault.azure.net/.default');
  const res = await fetch(`${url.replace(/\/$/, '')}/secrets/${encodeURIComponent(nombre)}?api-version=7.4`, {
    headers: { Authorization: `Bearer ${token?.token}` },
  });
  if (!res.ok) throw new Error(`No se pudo leer el secreto ${nombre} de Key Vault (${res.status})`);
  return ((await res.json()) as { value: string }).value;
}

/**
 * Token de Entra para PostgreSQL Flexible Server (autenticación con la identidad gestionada, sin contraseña).
 * Se pide en cada conexión nueva (duran ~1 h); con varias identidades, AZURE_CLIENT_ID elige cuál.
 */
export function tokenPostgresEntra(): () => Promise<string> {
  let cred: { getToken(scope: string): Promise<{ token: string } | null> } | null = null;
  return async () => {
    if (!cred) {
      const { DefaultAzureCredential } = await import('@azure/identity');
      cred = new DefaultAzureCredential();
    }
    const t = await cred.getToken('https://ossrdbms-aad.database.windows.net/.default');
    if (!t) throw new Error('No se pudo obtener un token de Entra para PostgreSQL');
    return t.token;
  };
}
