import ExcelJS from "exceljs";

function styleHeader(row) {
  row.height = 24;
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF244469" } };
  row.alignment = { vertical: "middle" };
}

function table(sheet, headings, widths, rows) {
  sheet.columns = widths.map((width) => ({ width }));
  styleHeader(sheet.addRow(headings));
  sheet.addRows(rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (rows.length) sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(headings.length).address };
}

export async function workbookBytes(report, input) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet("流派汇总");
  summary.columns = [24, 18, 13, 52, 13, 14, 15, 16].map((width) => ({ width }));
  summary.addRows([
    ["小组标签", report.groupTag || ""],
    ["周起始日", report.week || ""],
    ["来源", ({ sample: "截图示例数据", api: "官方 API", import: "导入数据" })[report.source] || ""],
    ["有阵容进攻", report.total],
    ["未计入", report.skipped],
    [],
  ]);
  if (report.telemetry?.expectedAttacks !== undefined) {
    summary.getCell("C4").value = "组内已知进攻";
    summary.getCell("D4").value = report.telemetry.expectedAttacks;
    summary.getCell("C5").value = "由防守日志补齐";
    summary.getCell("D5").value = report.telemetry.recoveredFromDefense;
  }
  styleHeader(summary.addRow(["流派", "场数", "占比", "细分", "三星率", "三星场数", "有星数场次", "平均星数"]));
  summary.views = [{ state: "frozen", ySplit: 7 }];
  report.rows.forEach((entry, index) => {
    const number = index + 8;
    const row = summary.addRow([
      entry.name,
      entry.count,
      { formula: `IFERROR(B${number}/$B$4,0)`, result: entry.share },
      entry.details.map(({ name, count }) => name + " " + count).join(" · "),
      entry.threeStarRate, entry.scoredCount ? entry.threeStarCount : null,
      entry.scoredCount || null, entry.averageStars,
    ]);
    row.getCell(1).font = { bold: true, color: { argb: "FF" + entry.color.slice(1).toUpperCase() } };
    row.getCell(3).numFmt = "0.0%";
    row.getCell(5).numFmt = "0.0%";
    row.getCell(8).numFmt = "0.00";
  });
  for (const note of report.notes) summary.addRow([note]);

  if (report.attacks.length) {
    const sheet = workbook.addWorksheet("进攻明细");
    table(sheet, ["进攻编号", "进攻时间", "玩家标签", "玩家名称", "对手标签", "流派", "合并流派",
      "识别方式", "阵容来源", "星数", "摧毁率", "阵容码", "战斗用时 (秒)"], [44, 27, 16, 22, 16, 20, 19, 16, 16, 10, 12, 48, 18],
    report.attacks.map((attack) => [
      attack.id, attack.timestamp, attack.playerTag, attack.playerName, attack.opponentTag,
      attack.strategy ?? attack.name, attack.category, attack.classification,
      ({ attack: "进攻日志", defense: "防守日志", group: "小组日志" })[attack.armySource],
      attack.stars, attack.destruction, attack.armyShareCode, attack.durationSeconds,
    ]));
  } else if (Array.isArray(input.counts)) {
    const sheet = workbook.addWorksheet("分类明细");
    table(sheet, ["流派", "场数"], [26, 15], input.counts.map((row) => [
      row.name ?? row.strategy ?? row.category, Number(row.count),
    ]));
  }
  if (input.standings?.length) {
    const sheet = workbook.addWorksheet("小组排名");
    table(sheet, ["名次", "成员", "村庄标签", "进攻场次", "防守场次", "进攻杯", "防守杯",
      "最终杯数", "进攻总星", "进攻平均摧毁率 (%)", "防守被拿总星", "防守平均摧毁率 (%)",
      "最近进攻 (UTC)", "最近防守 (UTC)", "平均进攻用时 (秒)", "进攻用时样本", "平均防守用时 (秒)", "防守用时样本"],
    [10, 26, 18, 14, 14, 13, 13, 14, 13, 23, 16, 23, 27, 27, 21, 16, 21, 16],
    input.standings.map((row) => [
      row.rank, row.playerName, row.playerTag, row.attackCount, row.defenseCount,
      row.attackTrophies, row.defenseTrophies, row.trophies, row.attackStars,
      row.attackDestruction, row.defenseStars, row.defenseDestruction,
      row.lastAttackAt, row.lastDefenseAt, row.attackDurationAverage, row.attackDurationCount,
      row.defenseDurationAverage, row.defenseDurationCount,
    ]));
    sheet.getColumn(10).numFmt = "0.0";
    sheet.getColumn(12).numFmt = "0.0";
    sheet.getColumn(15).numFmt = "0.0";
    sheet.getColumn(17).numFmt = "0.0";
  }
  if (input.battleViews) {
    summary.getCell("C1").value = "查询村庄";
    summary.getCell("D1").value = input.battleViews.playerName || input.battleViews.playerTag;
    if (input.battleViews.standing) {
      const standing = input.battleViews.standing;
      summary.getCell("E1").value = "当前名次";
      summary.getCell("F1").value = standing.rank;
      summary.getCell("E2").value = "最终杯数";
      summary.getCell("F2").value = standing.trophies;
    }
    for (const [direction, label] of [["attacks", "个人进攻"], ["defenses", "个人防守"]]) {
      const sheet = workbook.addWorksheet(label);
      const isDefense = direction === "defenses";
      const headings = [isDefense ? "防守时间 (UTC)" : "进攻时间 (UTC)", "对手", "对手标签", "进攻方星数", "摧毁率",
        "进攻流派（推断）", "进攻阵容码", "奖杯变化"];
      const widths = [28, 24, 18, 14, 14, 23, 52, 14];
      const noteColumn = headings.length + 1;
      if (isDefense) {
        headings.push("防守备注");
        widths.push(50);
      }
      headings.push("战斗用时 (秒)");
      widths.push(18);
      table(sheet, headings, widths, input.battleViews[direction].map((entry) => [
        entry.timestamp, entry.opponentName, entry.opponentTag, entry.stars,
        entry.destruction, entry.strategy, entry.armyShareCode, entry.trophyDelta ?? entry.trophies,
        ...(isDefense ? [typeof entry.note === "string" ? entry.note : ""] : []),
        entry.durationSeconds,
      ]));
      if (isDefense) sheet.getColumn(noteColumn).alignment = { vertical: "top", wrapText: true };
    }
  }
  return workbook.xlsx.writeBuffer();
}
