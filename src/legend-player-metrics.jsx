import { useCallback, useEffect, useRef, useState } from "react";

const cacheLifetime = 10 * 60 * 1000;
const retryDelay = 60 * 1000;
const batchSize = 20;

export function useLegendPlayerMetrics(rows, { active, refreshKey }) {
  const [status, setStatus] = useState(new Map());
  const [nearby, setNearby] = useState(new Set());
  const observer = useRef(null);
  const observed = useRef(new Set());
  const pending = useRef(false);
  const deferred = useRef(new Map());

  const observeRow = useCallback((node) => {
    if (!node) return;
    observed.current.add(node);
    observer.current?.observe(node);
    return () => {
      observed.current.delete(node);
      observer.current?.unobserve(node);
      setNearby((previous) => {
        if (!previous.has(node)) return previous;
        const next = new Set(previous);
        next.delete(node);
        return next;
      });
    };
  }, []);

  useEffect(() => {
    if (!active || typeof IntersectionObserver !== "function") return;
    let observing = true;
    const intersection = new IntersectionObserver((entries) => {
      if (!observing) return;
      setNearby((previous) => {
        const next = new Set(previous);
        let changed = false;
        for (const { target, isIntersecting } of entries) {
          if (!observed.current.has(target) || next.has(target) === isIntersecting) continue;
          if (isIntersecting) next.add(target);
          else next.delete(target);
          changed = true;
        }
        return changed ? next : previous;
      });
    }, { rootMargin: "160px 0px" });
    observer.current = intersection;
    for (const node of observed.current) intersection.observe(node);
    return () => {
      observing = false;
      observer.current = null;
      intersection.disconnect();
      setNearby((previous) => previous.size ? new Set() : previous);
    };
  }, [active]);

  useEffect(() => {
    const api = window.cocApp;
    if (!active || pending.current || typeof api?.fetchLegendPlayerMetrics !== "function") return;

    const nearTags = new Set([...nearby].map((node) => node.dataset.playerTag));
    const candidates = typeof IntersectionObserver === "function"
      ? rows.filter(({ playerTag }) => nearTags.has(playerTag)) : rows.slice(0, batchSize);
    const now = Date.now();
    const tags = [];
    for (const { playerTag } of candidates) {
      if (!playerTag) continue;
      const wait = deferred.current.get(playerTag);
      if (wait && wait.key === refreshKey && now < wait.until) continue;
      const cached = status.get(playerTag);
      if (cached && now - cached.checkedAt < (cached.metrics === null ? retryDelay : cacheLifetime)) continue;
      tags.push(playerTag);
      if (tags.length === batchSize) break;
    }
    if (!tags.length) return;
    pending.current = true;

    function finish(entries) {
      const byTag = new Map();
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (entry?.playerTag) byTag.set(entry.playerTag, entry.metrics);
      }
      const checkedAt = Date.now();
      for (const tag of tags) {
        if (byTag.has(tag)) deferred.current.delete(tag);
        else deferred.current.set(tag, { key: refreshKey, until: checkedAt + retryDelay });
      }
      pending.current = false;
      setStatus((previous) => {
        const next = new Map(previous);
        for (const tag of tags) {
          if (byTag.has(tag)) next.set(tag, { checkedAt, metrics: byTag.get(tag) ?? null });
        }
        return next;
      });
    }

    void Promise.resolve().then(() => api.fetchLegendPlayerMetrics({ playerTags: tags }))
      .then((result) => finish(result?.entries), () => finish(null));
  }, [active, nearby, refreshKey, rows, status]);

  return { statuses: status, observeRow };
}
