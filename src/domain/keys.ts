const KEY = "allowance-tracker/keys";

export function loadKeys(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const keys: Record<string, string> = {};
    for (const [id, apiKey] of Object.entries(value)) {
      if (typeof apiKey === "string" && apiKey.trim()) keys[id] = apiKey.trim();
    }
    return keys;
  } catch {
    return {};
  }
}

export function saveKeys(keys: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // Tracking still works for this session if storage is blocked.
  }
}

export function clearKeys(): void {
  localStorage.removeItem(KEY);
}
