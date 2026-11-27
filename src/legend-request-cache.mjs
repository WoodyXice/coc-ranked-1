const maxAgeMs = 10 * 60 * 1000;
const emptyRequest = Object.freeze({ status: "idle", data: null, error: "", fetchedAt: null, pending: null });

export function createLegendRequestCache(load, now = Date.now) {
  const entries = new Map();
  const listeners = new Set();

  function read(key) {
    return entries.get(key) ?? emptyRequest;
  }

  function update(key, fields) {
    entries.set(key, { ...read(key), ...fields });
    for (const listener of listeners) listener();
  }

  function request(key, force = false) {
    if (key === null) return null;
    const previous = read(key);
    if (previous.pending) return previous.pending;
    if (!force && previous.fetchedAt !== null && now() - previous.fetchedAt < maxAgeMs) {
      if (previous.status === "error") update(key, { status: "ready", error: "" });
      return null;
    }

    const pending = Promise.resolve().then(() => load(key, force)).then(
      (data) => update(key, { status: "ready", data, fetchedAt: now(), pending: null }),
      (error) => update(key, { status: "error", error: error?.message || "查询失败，请重试。", pending: null }),
    );
    update(key, { status: "loading", pending, error: "" });
    return pending;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return { read, request, subscribe };
}
