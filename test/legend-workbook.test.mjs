import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { readLegendWorkbook, writeLegendWorkbook } from "../desktop/legend-workbook.mjs";

async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "coc-ranked-xlsx-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  return dir;
}

function snapshot(size) {
  const now = "2026-11-28T11:26:29.103Z";
  const rows = Array.from({ length: size }, (_, i) => ({
    rank: i + 1, playerTag: `#P${i}`, playerName: i % 3 ? `玩家·龍🐉·Việt·عليّ·${i}` : "=1+1 & 龙 🐉",
    trophies: 8000 - Math.floor(i / 5), previousRank: i === 0 ? null : i,
    townHallLevel: i % 3 ? null : 18, clanName: i % 2 ? "部落" : "", clanTag: i % 2 ? "#CLAN" : "",
  }));
  const entries = rows.slice(0, -1).map(({ playerTag }, i) => ({
    playerTag, checkedAt: Date.parse(now) - i,
    metrics: i % 13 === 0 ? null : i % 7 === 0 ? {
      strategy: null, strategyStatus: "no-army", strategyCount: 0, attackCount: 1, threeStarRate: 0,
      averageDailyAttack: null, attackDays: 0, averageDailyNet: null, completedDays: 0, strategies: [],
    } : {
      strategy: "龙流", strategyCount: 9, attackCount: 13, threeStarRate: 8 / 13,
      averageDailyAttack: 234.5, attackDays: 2, averageDailyNet: -15.5, completedDays: 2,
      strategies: [{ strategy: "龙流", count: 9, scoredCount: 9, threeStarCount: 8 },
        { strategy: "蓝胖", count: 5, scoredCount: 4, threeStarCount: 0 },
        { strategy: "未出星数", count: 1, scoredCount: 0, threeStarCount: 0 }],
    },
  })).reverse();
  return { board: { location: "global", requestedLimit: size, fetchedAt: now, rows, hasTierData: true,
    paginationInterrupted: false, cacheGeneration: "79cae23b-5baa-4fef-99c7-7b28e0b39d74" }, entries };
}

test("legend workbook round trips an independently readable 200-player Excel ranking and per-style results", async t => {
  const dir = await directory(t);
  const file = join(dir, "cache", "global.xlsx");
  const expected = snapshot(200);
  await writeLegendWorkbook(file, { ...expected, board: { ...expected.board, token: "must-not-be-stored" },
    entries: expected.entries.map(entry => ({ ...entry, battleLog: "must-not-be-stored" })) });
  assert.deepEqual(await readLegendWorkbook(file), expected);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  assert.deepEqual(book.worksheets.map(ws => ws.name), ["榜单信息", "玩家排名", "两日战绩", "流派明细"]);
  const ranked = book.getWorksheet("玩家排名");
  assert.equal(ranked.rowCount, 201);
  assert.equal(ranked.getCell("C2").value, "=1+1 & 龙 🐉");
  const styles = book.getWorksheet("流派明细");
  assert.equal(styles.getCell("B2").value, "龙流");
  assert.equal(styles.getCell("F2").value, 8 / 9);
  assert.equal(styles.getCell("F2").numFmt, "0.0%");
  for (const ws of book.worksheets) {
    ws.eachRow(row => assert.ok(!row.values.includes("must-not-be-stored")));
  }
  const small = { board: { ...expected.board, rows: [], location: 32000000, hasTierData: false,
    paginationInterrupted: true }, entries: [] };
  delete small.board.cacheGeneration;
  await writeLegendWorkbook(file, small);
  assert.deepEqual(await readLegendWorkbook(file), small);
  assert.deepEqual(await readdir(join(dir, "cache")), ["global.xlsx"]);
});

test("a 10,000-player board with multiple strategies per player round trips through XLSX streams", async t => {
  const dir = await directory(t);
  const file = join(dir, "board10000.xlsx");
  const expected = snapshot(10000);
  await writeLegendWorkbook(file, expected);
  assert.deepEqual(await readLegendWorkbook(file), expected);
});

test("missing, truncated, incompatible and incomplete workbooks are cache misses", async t => {
  const dir = await directory(t);
  const file = join(dir, "global.xlsx");
  assert.equal(await readLegendWorkbook(file), null);
  await writeFile(file, "not an Excel file");
  assert.equal(await readLegendWorkbook(file), null);
  await writeLegendWorkbook(file, snapshot(9));
  const bytes = await readFile(file);
  await writeFile(file, bytes.subarray(0, -5));
  assert.equal(await readLegendWorkbook(file), null);
  for (const change of [
    book => { book.getWorksheet("榜单信息").getCell("A2").value = 2; },
    book => { book.getWorksheet("玩家排名").getCell("C1").value = "不同列"; },
    book => { book.getWorksheet("两日战绩").spliceRows(3, 1); },
    book => { book.getWorksheet("流派明细").getCell("A2").value = "#FOREIGN"; },
    book => { book.getWorksheet("流派明细").getCell("E2").value = { formula: "1+1", result: 2 }; },
  ]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    change(book);
    await book.xlsx.writeFile(file);
    assert.equal(await readLegendWorkbook(file), null);
  }
});

test("writing invalid data or a failed replacement leaves the previous file intact and reports the error", async t => {
  const dir = await directory(t);
  const file = join(dir, "board.xlsx");
  const original = snapshot(3);
  await writeLegendWorkbook(file, original);
  const broken = { ...original, entries: original.entries.map(entry => ({ ...entry, playerTag: "#OTHER" })) };
  await assert.rejects(writeLegendWorkbook(file, broken));
  assert.deepEqual(await readLegendWorkbook(file), original);
  const occupied = join(dir, "occupied.xlsx");
  await mkdir(occupied);
  await assert.rejects(writeLegendWorkbook(occupied, original));
  assert.deepEqual((await readdir(dir)).sort(), ["board.xlsx", "occupied.xlsx"]);
});
