import { isIPv4 } from "node:net";
import { classifyBattleArmy, getReport, sampleData } from "../analytics.mjs";
import { buildGroupedPlayerReport, createLegendBattleLogCollector, decodeArmyShareCode, fetchRankedReport, fetchTemporaryGroupDetails, fetchTemporaryPlayer, playerHistoryWithWeeklyBoards, weeklyPlayerBattleViews } from "../collector.mjs";
import { legendPlayerMetrics } from "../insights.mjs";

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
  return records.map(battle => {
    const army = battle.army?.troops?.length ? battle.army : decodeArmyShareCode(battle.armyShareCode) ?? battle.army ?? null;
    const strategy = classifyBattleArmy(army) ?? battle.strategy ?? "";
    return { ...battle, army, strategy };
  });
}

function classifyBattleViews(battleViews) {
  return {
    ...battleViews,
    attacks: withStrategies(battleViews.attacks ?? []),
    defenses: withStrategies(battleViews.defenses ?? []),
  };
}

export function createLegendMetricsCollector(token) {
  const collect = createLegendBattleLogCollector({ token });
  return async (playerTag, archive) => {
    const history = await collect({ playerTag, archive });
    return legendPlayerMetrics({ ...history, attacks: withStrategies(history.attacks) });
  };
}

function buildReport(raw) {
  const classified = raw.battleViews ? { ...raw, battleViews: classifyBattleViews(raw.battleViews) } : raw;
  return { raw: classified, report: getReport(classified) };
}

export async function collectTemporaryPlayer(input, { playerHistory, ...requestOptions } = {}) {
  const result = await fetchTemporaryPlayer(input, requestOptions);
  const recent = result.history;
  const weekly = result.weeklyLeaderboard;
  const coverage = (rows) => ({
    count: rows.length,
    oldestAt: rows.reduce((oldest, row) => {
      const time = row.battleTimestamp || row.timestamp;
      return time && (!oldest || time < oldest) ? time : oldest;
    }, null),
  });
  let history;
  let historySaved = false;
  if (playerHistory) {
    try {
      history = playerHistory.merge(result.battleViews.playerTag, recent, result.fetchedAt, weekly);
      historySaved = true;
    } catch {
      console.warn("Could not save the player battle history.");
    }
  }
  history ??= playerHistoryWithWeeklyBoards(recent, weekly ? [weekly] : []);
  return {
    ...result,
    ...(weekly && { weeklyLeaderboard: { ...weekly, attacks: withStrategies(weekly.attacks),
      battleViews: classifyBattleViews(weeklyPlayerBattleViews(weekly, history)) } }),
    battleViews: classifyBattleViews(result.battleViews),
    history: classifyBattleViews(history),
    recentAttacks: withStrategies(recent.attacks),
    recentCoverage: result.battleViews.logAvailable === false ? null : {
      attacks: coverage(recent.attacks), defenses: coverage(recent.defenses),
    },
    historySaved,
  };
}

export function createTemporaryGroupService({ snapshots, now = () => new Date(), collect = fetchTemporaryGroupDetails } = {}) {
  const verifiedPlayers = new Map();
  const boards = new Map();

  function remember(result) {
    const playerTag = result?.battleViews?.playerTag;
    if (!playerTag) return;
    verifiedPlayers.delete(playerTag);
    const group = result.weeklyLeaderboard;
    if (!group) return;
    const scope = {
      groupTag: group.groupTag, seasonId: group.seasonId, week: group.week,
      roster: JSON.stringify(group.rows.map(({ playerTag, trophies, attackCount, defenseCount }) =>
        [playerTag, trophies, attackCount, defenseCount])),
    };
    // Older open pages may still refer to other members of the same group.
    const members = new Set(group.rows.map(row => row.playerTag));
    for (const [tag, prior] of verifiedPlayers) {
      if (prior.groupTag !== scope.groupTag) continue;
      if (prior.week !== scope.week || prior.seasonId !== scope.seasonId || !members.has(tag)) {
        verifiedPlayers.delete(tag);
      } else if (prior.roster !== scope.roster) {
        verifiedPlayers.set(tag, scope);
      }
    }
    if (members.has(playerTag)) verifiedPlayers.set(playerTag, scope);
    if (verifiedPlayers.size > 50) verifiedPlayers.delete(verifiedPlayers.keys().next().value);
  }

  async function fetch(input, token) {
    const playerTag = input?.playerTag;
    const scope = verifiedPlayers.get(playerTag);
    const time = now();
    if (!scope || scope.week !== rankedWeek(time)
        || input.groupTag !== scope.groupTag || input.seasonId !== scope.seasonId || input.week !== scope.week) {
      throw new Error("请重新查询该村庄，再打开本周小组排名。");
    }
    let entry = boards.get(scope.groupTag);
    if (!entry || entry.token !== token || entry.seasonId !== scope.seasonId
        || entry.week !== scope.week || entry.roster !== scope.roster) {
      entry = { ...scope, token };
    }
    boards.delete(scope.groupTag);
    boards.set(scope.groupTag, entry);
    if (boards.size > 3) boards.delete(boards.keys().next().value);
    const cachedMember = entry.board?.rows.some((member) => member.playerTag === playerTag);
    const lifetime = entry.board?.partial ? 60_000 : 10 * 60_000;
    if (!entry.pending && (!cachedMember || input.force === true || time.getTime() - entry.loadedAt >= lifetime)) {
      entry.pending = collect({ ...scope, playerTag, token }, { snapshots, now: time }).then((board) => {
        const lineups = board.attacks.filter((attack) => attack.armyShareCode || attack.army);
        const attacks = withStrategies(lineups);
        const listedAttacks = board.rows.reduce((sum, row) => sum + (row.attackCount ?? 0), 0);
        const { rows, total, notes, telemetry } = getReport({
          source: "api", groupTag: scope.groupTag, week: scope.week, attacks,
          telemetry: { expectedAttacks: Math.max(board.attacks.length, listedAttacks) },
        });
        // Send the classified lineups once; the chart only needs the group aggregates.
        const metaReport = { source: "api", groupTag: scope.groupTag, week: scope.week, rows, total, notes, telemetry };
        entry.board = { ...board, attacks, metaReport };
        entry.loadedAt = now().getTime();
      }).finally(() => { entry.pending = null; });
    }
    await entry.pending;
    if (scope !== verifiedPlayers.get(playerTag) || boards.get(scope.groupTag) !== entry || scope.week !== rankedWeek(now())) {
      throw new Error("正在查看的村庄或周次已切换，请重新打开小组排名。");
    }
    const standing = entry.board.rows.find((member) => member.playerTag === playerTag);
    if (!standing) throw new Error("完整小组榜中未找到该村庄，请重新查询。");
    return { ...entry.board, battleViews: { playerTag, standing, defenseTrophyMode: "earned" } };
  }

  function reset() {
    verifiedPlayers.clear();
    boards.clear();
  }

  return { remember, forget: (tag) => verifiedPlayers.delete(tag), fetch, reset };
}

export async function collectGroupedPlayer(input) {
  const result = await buildGroupedPlayerReport(input);
  if (!result) throw new Error("这份小组战报未找到该玩家，请更新本周排位后再试。");
  return { ...result, battleViews: classifyBattleViews(result.battleViews) };
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
  return buildReport(raw);
}

// A saved report is reused only within the ranked week it was collected in.
export function cachedReport(saved, now = new Date()) {
  if (saved?.raw?.week !== rankedWeek(now) || !Number.isFinite(Date.parse(saved.fetchedAt))) return null;
  return { ...buildReport(saved.raw), fetchedAt: saved.fetchedAt };
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
    leagueTier: { id: 105000035, name: "传奇 II", iconUrl: null, attackLimit: 30 },
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
