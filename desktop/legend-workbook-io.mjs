import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { utilityProcess } from "electron";

const modulePath = fileURLToPath(new URL("./legend-workbook-task.mjs", import.meta.url));
function run(job) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(modulePath, [], { serviceName: "榜单 Excel 缓存" });
    child.once("error", reject);
    child.once("spawn", () => child.postMessage(job));
    child.once("exit", () => reject(new Error("榜单缓存进程已退出")));
    child.once("message", result => {
      if (result.ok) resolve(result.value);
      else reject(new Error("榜单缓存操作失败"));
      child.kill();
    });
  });
}
export async function readWorkbook(file) {
  try { await access(file); } catch { return null; }
  return run({ file });
}
export const writeWorkbook = (file, snapshot) => run({ file, snapshot });
