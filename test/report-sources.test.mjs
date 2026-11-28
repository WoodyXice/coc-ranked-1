import assert from "node:assert/strict";
import test from "node:test";
import { createReportSources } from "../desktop/report-sources.mjs";

const group = { groupTag: "#GROUP", seasonId: 1795450000, week: "2026-11-23", fetchedAt: "2026-11-25T03:00:00Z" };
const report = owner => ({ fetchedAt: group.fetchedAt, raw: { ...group, source: "api", battleViews: { playerTag: owner } } });

test("returning to a previously opened saved village resolves only its own group snapshot", () => {
  const a = report("#AAA"), b = report("#BBB");
  const disk = new Map([["#AAA", a], ["#BBB", b]]);
  const sources = createReportSources(tag => disk.get(tag));
  const select = owner => ({ ...group, reportOwnerTag: owner });
  sources.show("#AAA", a);
  sources.show("#BBB", b);
  assert.equal(sources.resolve(select("#AAA")), a);
  assert.equal(sources.resolve(select("#BBB")), b);
  assert.equal(sources.resolve(group), b); // older renderer
  sources.show(null, { raw: { source: "sample" } });
  assert.throws(() => sources.resolve(group));
  assert.equal(sources.resolve(select("#AAA")), a);
  for (const fields of [{ reportOwnerTag: "#NOTOPEN" }, { groupTag: "#OTHER" }, { week: "2026-11-16" },
    { seasonId: group.seasonId - 604800 }, { fetchedAt: "2026-11-25T03:00:01Z" }]) {
    assert.throws(() => sources.resolve({ ...select("#AAA"), ...fields }));
  }
  disk.set("#AAA", { ...a, fetchedAt: "2026-11-25T04:00:00Z" });
  assert.throws(() => sources.resolve(select("#AAA")));
  sources.show("#AAA", null);
  disk.set("#AAA", a);
  assert.throws(() => sources.resolve(select("#AAA")));
});

test("a report still opens after a failed disk save and a subsequent village selection", () => {
  const a = report("#AAA");
  const sources = createReportSources(() => assert.fail("should use the unsaved capture"));
  sources.show("#AAA", a, false);
  sources.show("#BBB", report("#BBB"));
  assert.equal(sources.resolve({ ...group, reportOwnerTag: "#AAA" }), a);
});
