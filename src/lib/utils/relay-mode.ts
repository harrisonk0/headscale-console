const key = "hk-remote-https-only";
export function prefersHttpsRelay(): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
export function changeRelayMode(httpsOnly: boolean) {
  try {
    if (httpsOnly) localStorage.setItem(key, "true");
    else localStorage.removeItem(key);
    location.reload();
  } catch {
    throw new Error(
      "The browser could not save the connection setting. Check its storage permissions.",
    );
  }
}
