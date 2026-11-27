import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { legendDayNumber, nextLegendDayStart } from "../insights.mjs";

const cacheLifetime = 10 * 60 * 1000;
const retryDelay = 60 * 1000;
const batchSize = 20;

export function useLegendPlayerMetrics(rows, { active, refreshKey, location, loadAll }) {
  const [boards, setBoards] = useState(() => new Map());
  const [nearby, setNearby] = useState(new Set());
  const observer = useRef(null);
  const observed = useRef(new Set());
  const pending = useRef(new Set());
  const [day, setDay] = useState(() => legendDayNumber(Date.now()));
  useEffect(() => {
    if (!active) return;
    const now = Date.now();
    setDay(legendDayNumber(now));
    const timer = setTimeout(() => setDay(legendDayNumber(Date.now())), nextLegendDayStart(now) - now);
    return () => clearTimeout(timer);
  }, [active, day]);

  // Hold the freshness cutoff for one pass, including slow batches in a large leaderboard.
  const asOf = useMemo(() => Date.now(), [active, location, refreshKey, loadAll, nearby, day]);
  const statuses = useMemo(() => {
    const entries = boards.get(location);
    const fresh = new Map();
    const leagueDay = legendDayNumber(asOf);
    for (const { playerTag } of rows) {
      const entry = entries?.get(playerTag);
      if (!entry || entry.expiresAt <= asOf || entry.day !== leagueDay
        || (entry.metrics === null && entry.refreshKey !== refreshKey)) continue;
      fresh.set(playerTag, entry);
    }
    return fresh;
  }, [boards, location, rows, refreshKey, asOf]);

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
    if (!active || loadAll || typeof IntersectionObserver !== "function") return;
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
  }, [active, loadAll]);

  useEffect(() => {
    const api = window.cocApp;
    if (!active || location == null || pending.current.has(location) || typeof api?.fetchLegendPlayerMetrics !== "function") return;

    const nearTags = new Set([...nearby].map((node) => node.dataset.playerTag));
    const candidates = loadAll || typeof IntersectionObserver !== "function"
      ? rows : rows.filter(({ playerTag }) => nearTags.has(playerTag));
    const tags = candidates.map(({ playerTag }) => playerTag)
      .filter((tag) => tag && !statuses.has(tag)).slice(0, batchSize);
    if (!tags.length) return;
    pending.current.add(location);
    const requestDay = legendDayNumber(Date.now());

    function finish(results) {
      const byTag = new Map();
      for (const entry of Array.isArray(results) ? results : []) {
        if (entry?.playerTag) byTag.set(entry.playerTag, entry.metrics);
      }
      const checkedAt = Date.now();
      pending.current.delete(location);
      setBoards((previous) => {
        const next = new Map(previous);
        const entries = new Map(next.get(location));
        for (const [tag, entry] of entries) {
          if (entry.expiresAt <= asOf) entries.delete(tag);
        }
        for (const tag of tags) {
          const metrics = byTag.get(tag) ?? null;
          entries.set(tag, { metrics, checkedAt, refreshKey, day: requestDay,
            expiresAt: checkedAt + (metrics === null ? retryDelay : cacheLifetime) });
        }
        next.set(location, entries);
        return next;
      });
    }

    void Promise.resolve().then(() => api.fetchLegendPlayerMetrics({ location, playerTags: tags }))
      .then((result) => finish(result?.entries), () => finish(null));
  }, [active, loadAll, location, nearby, refreshKey, rows, statuses, asOf]);

  return { statuses, observeRow };
}
