/** Lee un secreto de Key Vault con identidad gestionada (sin claves en la configuración, ADR-07). */
export async function secretoKeyVault(url: string, nombre: string): Promise<string> {
  const { DefaultAzureCredential } = await import('@azure/identity');
  const token = await new DefaultAzureCredential().getToken('https://vault.azure.net/.default');
  const res = await fetch(`${url.replace(/\/$/, '')}/secrets/${encodeURIComponent(nombre)}?api-version=7.4`, { headers: { Authorization: `Bearer ${token?.token}` } });
  if (!res.ok) throw new Error(`No se pudo leer el secreto ${nombre} de Key Vault (${res.status})`);
  return ((await res.json()) as { value: string }).value;
}
