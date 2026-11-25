import { isIPv4 } from "node:net";
import { getReport, sampleData } from "../analytics.mjs";
import { decodeArmyShareCode, fetchRankedReport } from "../collector.mjs";

const hour = 3_600_000;
export const developerPortal = "https://developer.clashofclans.com/#/new-key";

export async function getPublicIp(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl("https://api.ipify.org", {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) {
      const ip = (await response.text()).trim();
      if (isIPv4(ip)) return { ip };
    } else {
      await response.body?.cancel();
    }
  } catch {
    // Show a retryable message without exposing network or proxy details.
  }
  throw new Error("暂时无法检测公网出口 IP，请稍后刷新。");
}

export function rankedWeek(now = new Date()) {
  const sinceReset = new Date(now.getTime() - 5 * hour);
  const daysSinceMonday = (sinceReset.getUTCDay() + 6) % 7;
  sinceReset.setUTCDate(sinceReset.getUTCDate() - daysSinceMonday);
  return sinceReset.toISOString().slice(0, 10);
}

function withStrategies(records) {
  const withArmy = records.map((battle) => ({
    ...battle,
    army: battle.army ?? decodeArmyShareCode(battle.armyShareCode),
  }));
  const attacks = withArmy.map(({ id, timestamp, armyShareCode, army }) => ({ id, timestamp, armyShareCode, army }));
  const classified = getReport({ source: "api", attacks }).attacks;
  const strategies = new Map(classified.map(({ id, strategy }) => [id, strategy]));
  return withArmy.map((battle) => ({ ...battle, strategy: battle.strategy || strategies.get(battle.id) || "" }));
}

export async function collectData({ playerTag, token } = {}, options = {}) {
  if (typeof playerTag !== "string" || !playerTag.trim()) throw new Error("请输入你的村庄 Tag。");
  if (typeof token !== "string" || !token.trim()) throw new Error("请输入 Supercell 开发者 API 令牌。");
  const { now = new Date(), ...requestOptions } = options;
  const raw = await fetchRankedReport({
    ...requestOptions,
    playerTag,
    token,
    week: rankedWeek(now),
    includeBattleViews: true,
  });
  if (raw.battleViews) {
    raw.battleViews = {
      ...raw.battleViews,
      attacks: withStrategies(raw.battleViews.attacks),
      defenses: withStrategies(raw.battleViews.defenses),
    };
  }
  return { raw, report: getReport(raw) };
}

export function sampleReport() {
  const playerTag = "#DEMO1";
  const standing = {
    rank: 2, playerTag, playerName: "演示村庄", clanTag: "",
    attackCount: 2, defenseCount: 2, attackStars: 5, defenseStars: 5,
    attackDestruction: 95.5, defenseDestruction: 91,
    attackTrophies: 69, defenseTrophies: 14, trophies: 83,
    lastAttackAt: "2026-11-24T12:46:00Z", lastDefenseAt: "2026-11-24T14:10:00Z",
    attackDurationAverage: 147, defenseDurationAverage: 163,
    attackDurationCount: 2, defenseDurationCount: 1,
  };
  const raw = {
    ...sampleData,
    standings: [
      {
        rank: 1, playerTag: "#DEMO2", playerName: "演示对手 A",
        attackCount: 3, defenseCount: 2, attackStars: 7, defenseStars: 3,
        attackDestruction: 92, defenseDestruction: 70,
        attackTrophies: 98, defenseTrophies: 43, trophies: 141,
      },
      standing,
    ],
    battleViews: {
      playerTag,
      playerName: "演示村庄",
      standing,
      defenseTrophyMode: "earned",
      attacks: withStrategies([
        { id: "sample-a1", timestamp: "2026-11-24T12:46:00Z", durationSeconds: 148, opponentTag: "#DEMO2", opponentName: "演示对手 A",
          stars: 3, destruction: 100, trophies: 40, trophyDelta: 40, armyShareCode: "h1p4e15_39i1x52-4x5d1x70u4x80-5x7s2x2-3x35", armySource: "attack", strategy: "天女蓝胖" },
        { id: "sample-a2", timestamp: "2026-11-24T11:20:00Z", durationSeconds: 146, opponentTag: "#DEMO3", opponentName: "演示对手 B",
          stars: 2, destruction: 91, trophies: 29, trophyDelta: 29, armyShareCode: "u12x132", armySource: "attack", strategy: "巨矛投手" },
      ]),
      defenses: withStrategies([
        { id: "sample-d1", timestamp: "2026-11-24T14:10:00Z", durationSeconds: 163, opponentTag: "#DEMO4", opponentName: "演示对手 C",
          stars: 2, destruction: 82, trophies: 14, trophyDelta: 14, armyShareCode: "h2p4e4_22i1x52-4x5d1x70u2x205-3x5s2x2-3x5", armySource: "defense", strategy: "龙流" },
        { id: "sample-d2", timestamp: "2026-11-24T10:42:00Z", opponentTag: "#DEMO5", opponentName: "演示对手 D",
          stars: 3, destruction: 100, trophies: 0, trophyDelta: 0, armyShareCode: "", armySource: "" },
      ]),
    },
  };
  return { raw, report: getReport(raw) };
}
