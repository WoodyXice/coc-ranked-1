import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { getReport } from "../analytics.mjs";
import { decodeArmyShareCode } from "../collector.mjs";
import { workbookBytes } from "../files.mjs";
import { armySets, attacksWithEquipment, defenseRanks, equipmentUsage, myAttacksByOpponent } from "../insights.mjs";

function strategyOf(code) {
  return getReport({ source: "api", attacks: [{ id: "x", armyShareCode: code }] }).attacks[0].strategy;
}

test("defense ranks sort by defense trophies, then fewer stars taken, then official rank", () => {
  const standings = [
    { playerTag: "#A", rank: 1, defenseTrophies: 50, defenseStars: 6, defenseCount: 3 },
    { playerTag: "#B", rank: 2, defenseTrophies: 80, defenseStars: 9, defenseCount: 3 },
    { playerTag: "#C", rank: 3, defenseTrophies: 50, defenseStars: 3, defenseCount: 3 },
    { playerTag: "#D", rank: 4, defenseTrophies: null, defenseStars: 0, defenseCount: 0 },
    { playerTag: "#E", rank: 5, defenseTrophies: 50, defenseStars: 3, defenseCount: 3 },
  ];
  assert.deepEqual([...defenseRanks(standings, "earned")], [["#B", 1], ["#C", 2], ["#E", 3], ["#A", 4]]);
  assert.equal(defenseRanks(standings, "lost").size, 0);
  assert.equal(defenseRanks(standings, "mixed").size, 0);
});

test("my attacks are grouped by opponent", () => {
  const mine = myAttacksByOpponent({ attacks: [
    { opponentTag: "#A", stars: 3, destruction: 100, trophyDelta: 40, timestamp: "2026-11-24T02:00:00Z" },
    { opponentTag: "#A", stars: 2, destruction: 80, trophies: 20, timestamp: "2026-11-24T01:00:00Z" },
  ] });
  assert.deepEqual(mine.get("#A").map((r) => [r.stars, r.trophies]), [[2, 20], [3, 40]]);
});

test("equipment usage groups gear under its hero and computes rates", () => {
  const attack = (id, playerTag, code, stars, destruction) => ({
    id, playerTag, playerName: playerTag, stars, destruction, army: decodeArmyShareCode(code),
  });
  const usage = equipmentUsage([
    attack("1", "#A", "h1e16_17-7e59_60u4x80", 3, 100),
    attack("2", "#A", "h1e16_15u4x80", 2, 90),
    attack("3", "#B", "h1e16_17u4x80", 3, 100),
    attack("4", "#B", "h0e0_1u4x80", 1, 50),
  ], [
    { playerTag: "#A", attackWins: 3, attackLosses: 1 },
    { playerTag: "#B", attackWins: null, attackLosses: null },
  ]);
  assert.deepEqual(usage.map((item) => [item.heroId, item.id]),
    [[0, 1], [0, 0], [1, 16], [1, 17], [1, 15], [7, 60], [7, 59]]);
  const monolith = usage.find((item) => item.id === 16);
  assert.equal(monolith.name, "擎天箭矢");
  assert.deepEqual(monolith.players.map((p) => [p.playerTag, p.carried, p.threeStarRate, p.weekWinRate]),
    [["#A", 2, 0.5, 0.75], ["#B", 1, 1, null]]);
});

test("queen charge bowler only needs the queen carrying Monolith Arrow", () => {
  assert.equal(strategyOf("h1e16_17u4x80-5x7"), "天女蓝胖");
  assert.equal(strategyOf("h1e16_17u4x80"), "天女蓝胖");
  assert.equal(strategyOf("h1e17_15u4x80-5x7"), "其他蓝胖");
});

test("Monolith Arrow queen wins over the invisible dragon rule", () => {
  assert.equal(strategyOf("h1e16_17-7e59_60u4x80s3x35"), "天女蓝胖");
});

test("invisible dragon bowler needs Dragon Duke with Electro Fangs and three invisibility spells", () => {
  assert.equal(strategyOf("h7e59_60u4x80s3x35"), "隐龙蓝胖");
  assert.equal(strategyOf("h7e60_53u4x80-2x8s4x35"), "其他蓝胖");
});

test("bowler classification uses hero gear ownership and supports older army records", () => {
  assert.equal(strategyOf("h1e17_15-2e16_22u4x80-5x7"), "其他蓝胖");
  assert.equal(strategyOf("h7e60_53-2e59u4x80s4x35"), "其他蓝胖");
  assert.equal(strategyOf("h1u4x80-5x7"), "天女蓝胖");
  assert.equal(strategyOf("u4x80-2x8s3x35"), "隐龙蓝胖");

  const troops = { 超级巨石投手: 4 };
  const classified = getReport({ source: "import", attacks: [
    { army: { troops, heroes: ["弓箭女皇"], heroEquipment: { 擎天箭矢: 1 } } },
    { army: { troops, heroes: [{ name: "飞龙公爵", equipment: ["雷电獠牙"] }], spells: { 隐形法术: 3 } } },
  ] }).attacks;
  assert.deepEqual(classified.map(({ strategy }) => strategy), ["天女蓝胖", "隐龙蓝胖"]);
});

test("workbook adds the defense top list and opponent defense ranks", async () => {
  const standings = [
    { rank: 1, playerTag: "#A", playerName: "A", defenseTrophies: 80, defenseStars: 3, defenseCount: 3, defenseThreeStars: 0, attackWins: 2, attackLosses: 1 },
    { rank: 2, playerTag: "#ME", playerName: "Me", defenseTrophies: 60, defenseStars: 3, defenseCount: 3, defenseThreeStars: 1 },
    ...Array.from({ length: 9 }, (_, index) => ({ rank: index + 3, playerTag: "#OTHER" + index, defenseTrophies: 50 - index })),
  ];
  const attacks = [{ id: "1", playerTag: "#A", stars: 3, destruction: 100, armyShareCode: "h1e16_17u4x80-5x7" }];
  const raw = {
    groupTag: "#G", week: "2026-11-23", source: "api", standings,
    attacks: attacks.map((a) => ({ ...a, army: decodeArmyShareCode(a.armyShareCode) })),
    battleViews: {
      playerTag: "#ME", playerName: "Me", defenseTrophyMode: "earned",
      standing: { attackCount: 3 },
      attacks: [
        { timestamp: "2026-11-24T00:00:00Z", opponentTag: "#A", stars: 2, destruction: 88, trophyDelta: 25 },
        { timestamp: "2026-11-24T01:00:00Z", opponentTag: "#A", stars: 0, destruction: null, trophyDelta: 0 },
        { timestamp: "2026-11-24T02:00:00Z", opponentTag: "#OTHER8", stars: 3, destruction: 100, trophyDelta: 40 },
      ],
    },
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await workbookBytes(getReport(raw), raw));
  const top = workbook.getWorksheet("防守前10");
  assert.equal(top.getRow(2).getCell(3).value, "#A");
  assert.equal(top.getRow(2).getCell(8).value, "是");
  assert.equal(top.getRow(2).getCell(1).fill.fgColor.argb, "FFFFE699");
  assert.equal(top.getRow(2).getCell(9).value, "2星 88% +25杯 @ 2026-11-24T00:00:00Z; 0星 0杯 @ 2026-11-24T01:00:00Z");
  assert.equal(top.getRow(3).getCell(8).value, "本人");
  assert.equal(top.getRow(4).getCell(8).value, "否");
  assert.equal(top.rowCount, 11);
  assert.equal(workbook.getWorksheet("装备携带"), undefined);
  const personal = workbook.getWorksheet("个人进攻");
  assert.equal(personal.getRow(1).getCell(9).value, "对手防守排名");
  assert.equal(personal.getRow(2).getCell(9).value, 1);
  assert.equal(personal.getRow(2).getCell(10).fill.fgColor.argb, "FFFFE699");
  assert.equal(personal.getRow(4).getCell(9).value, 11);
  assert.equal(personal.getRow(4).getCell(1).fill, undefined);
  assert.ok(workbook.getWorksheet("个人防守"));

  raw.battleViews.telemetry = { attacks: { logFailures: 1 } };
  const incomplete = new ExcelJS.Workbook();
  await incomplete.xlsx.load(await workbookBytes(getReport(raw), raw));
  assert.equal(incomplete.getWorksheet("防守前10").getRow(4).getCell(8).value, "—");
});

test("multi-gear filter keeps attacks carrying every selected item and splits army sets", () => {
  const attack = (id, code, stars) => ({ id, playerTag: "#A", stars, army: decodeArmyShareCode(code) });
  const attacks = [
    attack("1", "h1e16_17-7e59_60u4x80s3x35", 3),
    attack("2", "h1e16_17-7e59_53u4x80s3x35", 2),
    attack("3", "h1e16_17-7e59_60u9x132s2x10", 1),
  ];
  const matched = attacksWithEquipment(attacks, [16, 59, 60]);
  assert.deepEqual(matched.map((a) => a.id), ["1", "3"]);
  assert.deepEqual(attacksWithEquipment(attacks, []), []);
  const sets = armySets(attacksWithEquipment(attacks, [16]));
  assert.deepEqual(sets.map((set) => [set.count, set.averageStars]), [[2, 2.5], [1, 1]]);
});

test("army sets ignore deployment order and split stacks", () => {
  const attack = (id, code, stars, destruction) => ({ id, playerTag: "#A", stars, destruction, army: decodeArmyShareCode(code) });
  const sets = armySets([
    attack("1", "u4x80-5x7s3x35-1x2", 3, 100),
    attack("2", "u5x7-4x80s1x2-3x35", 2, 80),
    attack("3", "u2x80-5x7-2x80s3x35-1x2", 1, 60),
  ]);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].count, 3);
  assert.equal(sets[0].averageStars, 2);
  assert.equal(sets[0].averageDestruction, 80);
  assert.deepEqual(sets[0].army.troops.map((t) => [t.id, t.count]), [[7, 5], [80, 4]]);
});

test("army sets distinguish castle reinforcements and use the most recent gear and pet", () => {
  const sets = armySets([
    { timestamp: "2026-11-24T12:00:00+02:00", army: decodeArmyShareCode("h1p3e16_17i1x8-1x5d2x35u4x80") },
    { timestamp: "2026-11-24T11:00:00Z", army: decodeArmyShareCode("h1p4e15_17i1x5-1x8d2x35u4x80") },
    { timestamp: "2026-11-24T12:00:00Z", army: decodeArmyShareCode("h1p3e16_17i2x5d2x35u4x80") },
  ]);
  assert.deepEqual(sets.map(({ count }) => count), [2, 1]);
  assert.deepEqual(sets[0].army.clanCastleTroops.map(({ id, count }) => [id, count]), [[5, 1], [8, 1]]);
  assert.deepEqual(sets[0].army.heroes[0].equipment.map(({ id }) => id), [15, 17]);
  assert.equal(sets[0].army.heroes[0].pet.id, 4);
});
