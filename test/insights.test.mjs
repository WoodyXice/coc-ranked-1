import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { getReport } from "../analytics.mjs";
import { decodeArmyShareCode } from "../collector.mjs";
import { workbookBytes } from "../files.mjs";
import { defenseRanks, myAttacksByOpponent } from "../insights.mjs";

function strategyOf(code) {
  return getReport({ source: "api", attacks: [{ id: "x", armyShareCode: code }] }).attacks[0].strategy;
}
test("defense ranks sort by defense trophies, then fewer stars taken, then official rank", () => {
  const ranks = defenseRanks([
    { playerTag: "#A", rank: 1, defenseTrophies: 50, defenseStars: 6, defenseCount: 3 },
    { playerTag: "#B", rank: 2, defenseTrophies: 80, defenseStars: 9, defenseCount: 3 },
    { playerTag: "#C", rank: 3, defenseTrophies: 50, defenseStars: 3, defenseCount: 3 },
    { playerTag: "#D", rank: 4, defenseTrophies: null, defenseStars: 0, defenseCount: 0 },
    { playerTag: "#E", rank: 5, defenseTrophies: 50, defenseStars: 3, defenseCount: 3 },
  ]);
  assert.deepEqual([...ranks], [["#B", 1], ["#C", 2], ["#E", 3], ["#A", 4]]);
});

test("my attacks are grouped by opponent", () => {
  const mine = myAttacksByOpponent({ attacks: [
    { opponentTag: "#A", stars: 3, destruction: 100, trophyDelta: 40, timestamp: "2026-11-24T02:00:00Z" },
    { opponentTag: "#A", stars: 2, destruction: 80, trophies: 20, timestamp: "2026-11-24T01:00:00Z" },
  ] });
  assert.deepEqual(mine.get("#A").map((r) => [r.stars, r.trophies]), [[2, 20], [3, 40]]);
});

test("queen charge bowler needs Monolith Arrow and at least four healers", () => {
  assert.equal(strategyOf("h1e16_17u4x80-5x7"), "天女蓝胖");
  assert.equal(strategyOf("h1e16_17u4x80"), "其他蓝胖");
  assert.equal(strategyOf("h1e17_15u4x80-5x7"), "其他蓝胖");
});

test("invisible dragon bowler needs Dragon Duke with Electro Fangs and three invisibility spells", () => {
  assert.equal(strategyOf("h7e59_60u4x80s3x35"), "隐龙蓝胖");
  assert.equal(strategyOf("h7e60_53u4x80-2x8s4x35"), "其他蓝胖");
});

test("workbook adds the defense top list and opponent defense ranks", async () => {
  const standings = [
    { rank: 1, playerTag: "#A", playerName: "A", defenseTrophies: 80, defenseStars: 3, defenseCount: 3, defenseThreeStars: 0, attackWins: 2, attackLosses: 1 },
    { rank: 2, playerTag: "#ME", playerName: "Me", defenseTrophies: 60, defenseStars: 3, defenseCount: 3, defenseThreeStars: 1 },
  ];
  const attacks = [{ id: "1", playerTag: "#A", stars: 3, destruction: 100, armyShareCode: "h1e16_17u4x80-5x7" }];
  const raw = {
    groupTag: "#G", week: "2026-11-23", source: "api", standings,
    attacks: attacks.map((a) => ({ ...a, army: decodeArmyShareCode(a.armyShareCode) })),
    battleViews: {
      playerTag: "#ME", playerName: "Me", defenseTrophyMode: "earned",
      attacks: [{ timestamp: "2026-11-24T00:00:00Z", opponentTag: "#A", stars: 2, destruction: 88, trophyDelta: 25 }],
      defenses: [],
    },
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await workbookBytes(getReport(raw), raw));
  const top = workbook.getWorksheet("防守前10");
  assert.equal(top.getRow(2).getCell(3).value, "#A");
  assert.equal(top.getRow(2).getCell(8).value, "是");
  assert.equal(top.getRow(2).getCell(1).fill.fgColor.argb, "FFFFE699");
  assert.equal(top.getRow(3).getCell(8).value, "本人");
  assert.equal(workbook.getWorksheet("装备携带"), undefined);
  const personal = workbook.getWorksheet("个人进攻");
  assert.equal(personal.getRow(1).getCell(9).value, "对手防守排名");
  assert.equal(personal.getRow(2).getCell(9).value, 1);
});
