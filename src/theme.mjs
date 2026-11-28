import { useSyncExternalStore } from "react";

// Appearance preference: "system" follows the OS, "light"/"dark" pin it.
// The resolved theme lives on <html data-theme> so CSS can switch palettes.
const storageKey = "coc-theme";
const preferences = ["system", "light", "dark"];
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set();

function readPreference() {
  try {
    const saved = localStorage.getItem(storageKey);
    return preferences.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

let preference = readPreference();
let snapshot = null;

function resolve() {
  return preference === "system" ? (media?.matches ? "dark" : "light") : preference;
}

function apply() {
  const resolved = resolve();
  document.documentElement.dataset.theme = resolved;
  if (snapshot?.preference !== preference || snapshot?.resolved !== resolved) snapshot = { preference, resolved };
  for (const listener of listeners) listener();
}

media?.addEventListener("change", () => { if (preference === "system") apply(); });
apply();

export function setThemePreference(next) {
  if (!preferences.includes(next)) return;
  preference = next;
  try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable: keep for this session */ }
  apply();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

// Current value of a CSS custom property on <html>, for canvas and image export.
export function themeColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const themeLabels = { system: "跟随系统", light: "浅色", dark: "深色" };
