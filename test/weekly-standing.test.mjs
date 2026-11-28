import assert from "node:assert/strict";
import test from "node:test";
import { weeklyStanding } from "../src/weekly-standing.mjs";

test("weekly drill-downs keep the clicked split for the same week, group, player and score only", () => {
  const scope = { groupTag: "#GROUP", week: "2026-11-23", seasonId: 9 };
  const row = { playerTag: "#MOCK", attackCount: 22, defenseCount: 19, trophies: 1063, attackTrophies: 802, defenseTrophies: 261 };
  const board = { ...scope, battleViews: { playerTag: row.playerTag },
    rows: [{ ...row, attackTrophies: null, defenseTrophies: null }] };
  const origin = { ...scope, row };
  assert.deepEqual(weeklyStanding(board, row.playerTag, null, origin), row);
  for (const changed of [{ week: "2026-11-16" }, { seasonId: 8 }, { groupTag: "#ELSE" },
    { row: { ...row, attackCount: 21 } }, { row: { ...row, trophies: 1050 } }, { row: { ...row, playerTag: "#OTHER" } }]) {
    assert.deepEqual(weeklyStanding(board, row.playerTag, null, { ...origin, ...changed }), board.rows[0]);
  }
  assert.equal(weeklyStanding(board, "#OTHER", null, origin), null);
  const fresh = { ...row, attackCount: 23, trophies: 1103, attackTrophies: null, defenseTrophies: 0 };
  assert.deepEqual(weeklyStanding(board, row.playerTag, { ...scope, rows: [fresh] }, origin), fresh);
});
