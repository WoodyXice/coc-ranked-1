import { freshLegendSnapshot, legendDayNumber } from "../insights.mjs";

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
    if (!force && previous.fetchedAt !== null && freshLegendSnapshot(previous.fetchedAt, now())) {
      if (previous.status === "error") update(key, { status: "ready", error: "" });
      return null;
    }

    const pending = Promise.resolve().then(() => load(key, force)).then(
      (data) => {
        const capture = Date.parse(data?.fetchedAt);
        update(key, { status: "ready", data, fetchedAt: Number.isFinite(capture) ? capture : now(), pending: null });
        if (data?.revalidate && !force) return request(key, true);
      },
      (error) => update(key, { status: "error", error: error?.message || "查询失败，请重试。", pending: null }),
    );
    const oldDay = previous.fetchedAt !== null && legendDayNumber(previous.fetchedAt) !== legendDayNumber(now());
    update(key, { status: "loading", pending, error: "", ...(oldDay && { data: null, fetchedAt: null }) });
    return pending;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return { read, request, subscribe };
}
