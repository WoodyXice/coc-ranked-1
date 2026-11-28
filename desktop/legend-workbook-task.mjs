import { readLegendWorkbook, writeLegendWorkbook } from "./legend-workbook.mjs";

process.parentPort.once("message", async ({ data: { file, snapshot } }) => {
  try {
    if (snapshot) {
      await writeLegendWorkbook(file, snapshot);
      process.parentPort.postMessage({ ok: true });
    } else {
      process.parentPort.postMessage({ ok: true, value: await readLegendWorkbook(file) });
    }
  } catch {
    process.parentPort.postMessage({ ok: false });
  }
});
