/** Guacamole reads the raw query, while CDNs may encode its operation as a key. */
export function guacamoleQuery(url: URL): string | null {
  const entries=[...url.searchParams.entries()];
  if(entries.length!==1 || entries[0][1]!=="")return null;
  const operation=entries[0][0];
  const uuid="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  return operation==="connect" || new RegExp(`^(read:${uuid}:[0-9]+|write:${uuid})$`).test(operation) ? "?"+operation : null;
}
