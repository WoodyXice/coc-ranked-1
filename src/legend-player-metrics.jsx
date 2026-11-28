import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { legendDayNumber, nextLegendDayStart } from "../insights.mjs";
import { applyLegendMetricResults, legendMetricView, nextLegendMetricBatch, restoredLegendMetrics } from "./legend-metric-batch.mjs";

export function useLegendPlayerMetrics(rows, { active, refreshKey, location, loadAll, limit = 200, cachedMetrics }) {
  const [boards, setBoards] = useState(() => new Map());
  const [nearby, setNearby] = useState(new Set());
  const observer = useRef(null);
  const observed = useRef(new Set());
  const pending = useRef(new Set());
  const [day, setDay] = useState(() => legendDayNumber(Date.now()));
  const [expiryRevision, setExpiryRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const now = Date.now();
    setDay(legendDayNumber(now));
    const timer = setTimeout(() => setDay(legendDayNumber(Date.now())), nextLegendDayStart(now) - now);
    return () => clearTimeout(timer);
  }, [active, day]);

  // Hold the freshness cutoff for one pass, including slow batches in a large leaderboard.
  const asOf = useMemo(() => Date.now(), [active, location, refreshKey, loadAll, nearby, day, expiryRevision]);
  const saved = useMemo(() => restoredLegendMetrics(cachedMetrics, Date.now()), [cachedMetrics, day]);
  const view = useMemo(() => legendMetricView(rows, boards.get(location), saved, asOf, refreshKey),
    [rows, boards, location, saved, asOf, refreshKey]);

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
    const requestDay = legendDayNumber(Date.now());
    const tags = nextLegendMetricBatch(candidates, view.settled, boards.get(location), requestDay, saved);
    if (!tags.length) {
      // A warm disk snapshot can expire while the board stays open.
      let firstExpiry = Infinity;
      for (const { playerTag } of candidates) {
        const until = view.statuses.get(playerTag)?.restoredUntil;
        if (until != null) firstExpiry = Math.min(firstExpiry, until);
      }
      if (!Number.isFinite(firstExpiry)) return;
      const timer = setTimeout(() => setExpiryRevision(revision => revision + 1), Math.max(1, firstExpiry - Date.now()));
      return () => clearTimeout(timer);
    }
    pending.current.add(location);

    function finish(result) {
      const receivedAt = Date.now();
      pending.current.delete(location);
      setBoards((previous) => {
        const next = new Map(previous);
        next.set(location, applyLegendMetricResults(previous.get(location), tags, result, requestDay, refreshKey, receivedAt));
        return next;
      });
    }

    void Promise.resolve().then(() => api.fetchLegendPlayerMetrics({ location, limit, playerTags: tags, progressive: true }))
      .then(finish, () => finish(null));
  }, [active, loadAll, location, limit, nearby, refreshKey, rows, view, boards, saved]);

  const { statuses, pendingCount, staleCount, staleFailedCount } = view;
  return { statuses, pendingCount, staleCount, staleFailedCount, observeRow, day };
}
