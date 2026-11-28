import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import ExcelJS from "exceljs";
import unzipper from "unzipper";

const version = 1;
const headings = {
  榜单信息: ["格式版本", "地区", "请求排名上限", "榜单获取时间（UTC）", "含段位", "分页中断", "玩家数", "战报条数", "流派明细数", "缓存批次"],
  玩家排名: ["名次", "玩家标签", "村庄名", "当前杯数", "上次名次", "大本营", "部落名", "部落标签"],
  两日战绩: ["玩家标签", "战报获取时间（UTC）", "有战报", "常用流派", "识别状态", "常用流派场次", "有效进攻", "三星率", "日均进攻杯", "完整进攻日", "日均净杯", "完整攻防日", "流派数"],
  流派明细: ["玩家标签", "流派", "使用场次", "有星数场次", "三星场次", "三星率"],
};
const sheetNames = Object.keys(headings);
const rates = { 两日战绩: 8, 流派明细: 6 };
const count = n => Number.isSafeInteger(n) && n >= 0;
const tag = s => typeof s === "string" && /^#[A-Z0-9]{2,20}$/.test(s);
const isoTime = s => typeof s === "string" && Number.isFinite(Date.parse(s));
const nullable = (v, test) => v === null || test(v);
const text = v => typeof v === "string";
const bool = v => typeof v === "boolean";
const rate = v => Number.isFinite(v) && v >= 0 && v <= 1;

function requireValid(ok) {
  if (!ok) throw new Error("传奇榜 Excel 缓存格式或行数无效。");
}

function validate({ board, entries }) {
  requireValid(board && (board.location === "global" || (count(board.location) && board.location > 0))
    && count(board.requestedLimit) && board.requestedLimit > 0 && isoTime(board.fetchedAt)
    && bool(board.hasTierData) && bool(board.paginationInterrupted)
    && (board.cacheGeneration === undefined || (text(board.cacheGeneration) && board.cacheGeneration.length > 0))
    && Array.isArray(board.rows) && board.rows.length <= board.requestedLimit && Array.isArray(entries));
  const ranked = new Set();
  for (const r of board.rows) {
    requireValid(tag(r.playerTag) && !ranked.has(r.playerTag) && count(r.rank) && r.rank > 0 && r.rank <= board.requestedLimit
      && text(r.playerName) && count(r.trophies) && nullable(r.previousRank, count)
      && nullable(r.townHallLevel, count) && text(r.clanName) && (r.clanTag === "" || tag(r.clanTag)));
    ranked.add(r.playerTag);
  }
  const received = new Set();
  let styles = 0;
  for (const { playerTag, checkedAt, metrics: m } of entries) {
    requireValid(ranked.has(playerTag) && !received.has(playerTag) && count(checkedAt) && checkedAt <= 8.64e15);
    received.add(playerTag);
    if (m === null) continue;
    requireValid(m && nullable(m.strategy, text) && (m.strategyStatus === undefined || text(m.strategyStatus))
      && count(m.strategyCount) && count(m.attackCount) && nullable(m.threeStarRate, rate)
      && nullable(m.averageDailyAttack, Number.isFinite) && nullable(m.averageDailyNet, Number.isFinite)
      && count(m.attackDays) && count(m.completedDays) && Array.isArray(m.strategies));
    const names = new Set();
    for (const s of m.strategies) {
      requireValid(text(s.strategy) && s.strategy.length && !names.has(s.strategy)
        && count(s.count) && count(s.scoredCount) && count(s.threeStarCount)
        && s.threeStarCount <= s.scoredCount && s.scoredCount <= s.count);
      names.add(s.strategy);
    }
    styles += m.strategies.length;
  }
  // Excel allows 1,048,576 rows including the header.
  requireValid(Math.max(board.rows.length, entries.length, styles) < 1048576);
  return styles;
}

function sheet(workbook, name) {
  const titles = headings[name];
  const out = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  out.columns = titles.map(title => ({ width: title.includes("时间") || title === "缓存批次" ? 36 : Math.max(15, title.length * 2 + 3) }));
  if (rates[name]) out.getColumn(rates[name]).numFmt = "0.0%";
  const header = out.addRow(titles);
  header.font = { bold: true };
  header.commit();
  return out;
}

export async function writeLegendWorkbook(path, snapshot) {
  const styleCount = validate(snapshot);
  const { board, entries } = snapshot;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  const stream = file.createWriteStream();
  const closed = finished(stream);
  closed.catch(() => {}); // An early disk error may arrive before ExcelJS commits its last worksheet.
  try {
    const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useSharedStrings: true, useStyles: true,
      zip: { zlib: { level: 1 } }, creator: "coc查询工具" });
    const info = sheet(book, "榜单信息");
    info.addRow([version, board.location, board.requestedLimit, board.fetchedAt, board.hasTierData, board.paginationInterrupted,
      board.rows.length, entries.length, styleCount, board.cacheGeneration]).commit();
    info.commit();
    const ranks = sheet(book, "玩家排名");
    for (const r of board.rows) ranks.addRow([r.rank, r.playerTag, r.playerName, r.trophies, r.previousRank,
      r.townHallLevel, r.clanName, r.clanTag]).commit();
    ranks.commit();
    const stats = sheet(book, "两日战绩");
    for (const { playerTag, checkedAt, metrics: m } of entries) {
      stats.addRow([playerTag, new Date(checkedAt).toISOString(), m !== null, m?.strategy, m?.strategyStatus, m?.strategyCount,
        m?.attackCount, m?.threeStarRate, m?.averageDailyAttack, m?.attackDays, m?.averageDailyNet, m?.completedDays,
        m?.strategies.length ?? 0]).commit();
    }
    stats.commit();
    const styles = sheet(book, "流派明细");
    for (const { playerTag, metrics } of entries) {
      for (const s of metrics?.strategies ?? []) {
        styles.addRow([playerTag, s.strategy, s.count, s.scoredCount, s.threeStarCount,
          s.scoredCount ? s.threeStarCount / s.scoredCount : null]).commit();
      }
    }
    styles.commit();
    await Promise.all([book.commit(), closed]);
    await rename(temporary, path);
  } finally {
    stream.destroy();
    await file.close();
    await rm(temporary, { force: true });
  }
}

async function* readSheets(path) {
  // Read one atomic revision. Only the compressed ZIP is buffered; worksheets are
  // inflated and parsed individually. ExcelJS's sequential ZIP reader can miss
  // sheets when the workbook metadata is written after them.
  const archive = await unzipper.Open.buffer(await readFile(path));
  const files = new Map(archive.files.map(f => [f.path, f]));
  // A UTF-8 sequence can straddle two inflate chunks, including in the shared
  // strings table. Use Node's stateful decoder before ExcelJS's SAX parser.
  const xml = name => files.get(name).stream().setEncoding("utf8");
  const book = new ExcelJS.stream.xlsx.WorkbookReader();
  await book._parseWorkbook(xml("xl/workbook.xml"));
  await book._parseRels(xml("xl/_rels/workbook.xml.rels"));
  if (files.has("xl/sharedStrings.xml")) {
    for await (const _ of book._parseSharedStrings(xml("xl/sharedStrings.xml"))) { /* caches strings in book */ }
  }
  for (const name of files.keys()) {
    const id = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name)?.[1];
    if (!id) continue;
    const stream = xml(name);
    try {
      for (const { value: ws } of book._parseWorksheet(stream, id)) yield ws;
    } finally {
      stream.destroy();
    }
  }
}

export async function readLegendWorkbook(path) {
  try {
    const seen = new Set();
    let info;
    const rows = [], entries = [], styles = new Map(), expectedStyles = new Map();
    let styleCount = 0;
    for await (const ws of readSheets(path)) {
      const name = ws.name;
      requireValid(sheetNames.includes(name) && !seen.has(name));
      seen.add(name);
      const titles = headings[name];
      let n = 0;
      for await (const row of ws) {
        requireValid(row.number === ++n && row.cellCount <= titles.length);
        const cells = titles.map((_, i) => row.getCell(i + 1).value);
        if (n === 1) {
          requireValid(titles.every((title, i) => title === cells[i]));
        } else if (name === "榜单信息") {
          requireValid(n === 2 && cells[0] === version);
          info = cells;
        } else if (name === "玩家排名") {
          const [rank, playerTag, playerName, trophies, previousRank, townHallLevel, clanName, clanTag] = cells;
          rows.push({ rank, playerTag, playerName, trophies, previousRank, townHallLevel, clanName: clanName ?? "", clanTag: clanTag ?? "" });
        } else if (name === "两日战绩") {
          const [playerTag, timestamp, available, strategy, strategyStatus, strategyCount, attackCount, threeStarRate,
            averageDailyAttack, attackDays, averageDailyNet, completedDays, totalStyles] = cells;
          requireValid(isoTime(timestamp) && bool(available) && count(totalStyles));
          requireValid(available || (totalStyles === 0 && cells.slice(3, 12).every(value => value === null)));
          expectedStyles.set(playerTag, totalStyles);
          const metrics = available ? { strategy, ...(strategyStatus !== null && { strategyStatus }), strategyCount, attackCount,
            threeStarRate, averageDailyAttack, attackDays, averageDailyNet, completedDays, strategies: [] } : null;
          entries.push({ playerTag, checkedAt: Date.parse(timestamp), metrics });
        } else {
          const [playerTag, strategy, used, scoredCount, threeStarCount, ratio] = cells;
          requireValid(scoredCount ? rate(ratio) && Math.abs(ratio - threeStarCount / scoredCount) < 1e-12 : ratio === null);
          if (!styles.has(playerTag)) styles.set(playerTag, []);
          styles.get(playerTag).push({ strategy, count: used, scoredCount, threeStarCount });
          styleCount++;
        }
      }
      requireValid(n >= 1);
    }
    requireValid(info && seen.size === sheetNames.length && rows.length === info[6] && entries.length === info[7] && styleCount === info[8]);
    for (const entry of entries) {
      const used = styles.get(entry.playerTag) ?? [];
      requireValid(expectedStyles.get(entry.playerTag) === used.length);
      if (entry.metrics) entry.metrics.strategies = used;
      styles.delete(entry.playerTag);
    }
    requireValid(!styles.size);
    const [, location, requestedLimit, fetchedAt, hasTierData, paginationInterrupted, , , , cacheGeneration] = info;
    const board = { location, requestedLimit, fetchedAt, rows, hasTierData, paginationInterrupted,
      ...(cacheGeneration !== null && { cacheGeneration }) };
    const snapshot = { board, entries };
    validate(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}
