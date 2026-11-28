import assert from "node:assert/strict";
import test from "node:test";
import { matchesStyleName, styleColors } from "../src/strategy-search.mjs";

test("strategy search accepts partial names, ordered characters and known aliases", () => {
  for (const term of ["", "蓝胖", "天 蓝", "超级蓝胖"]) assert.ok(matchesStyleName("天女蓝胖", term));
  assert.ok(matchesStyleName("根蔓武神", "根武"));
  assert.ok(!matchesStyleName("根蔓武神", "神根"));
  assert.ok(!matchesStyleName("气球冰狗", "蓝胖"));
  assert.deepEqual(styleColors("根蔓武神"), styleColors("根蔓武神"));
  assert.notEqual(styleColors("根蔓武神").pointColor, styleColors("天女蓝胖").pointColor);
});
