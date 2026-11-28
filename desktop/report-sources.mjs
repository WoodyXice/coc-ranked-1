function matches(report, group) {
  const raw = report?.raw;
  return raw?.source === "api" && raw.groupTag === group.groupTag && raw.seasonId === group.seasonId
    && raw.week === group.week && report.fetchedAt === group.fetchedAt;
}

// Keep only an index for persisted reports. The database holds one current capture per village.
export function createReportSources(readSaved) {
  const issued = new Map();
  let last = null;

  function show(ownerTag, report, persisted = true) {
    last = report?.raw?.source === "api" ? { ownerTag, report } : null;
    if (!ownerTag) return;
    if (last && report.fetchedAt) {
      issued.set(ownerTag, { fetchedAt: report.fetchedAt, transient: persisted ? null : report });
    } else {
      issued.delete(ownerTag);
    }
  }

  function resolve(group) {
    let report;
    if (group.reportOwnerTag === undefined) {
      // Older renderer callers can only refer to the most recently displayed report.
      report = last?.report;
    } else {
      const owner = group.reportOwnerTag;
      const entry = issued.get(owner);
      if (entry && entry.fetchedAt === group.fetchedAt) {
        report = last?.ownerTag === owner ? last.report : entry.transient ?? readSaved(owner);
      }
    }
    if (!matches(report, group)) throw new Error("小组战报已更新，请重新打开该村庄的排位排名。");
    return report;
  }

  return { show, resolve };
}
