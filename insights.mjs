// Group-level views shared by the app and the Excel export.

export const DEFENSE_TOP_N = 10;

const HERO_ORDER = [0, 1, 2, 4, 6, 7];

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function averageStarsTaken(row) {
  return Number.isFinite(row.defenseStars) && Number.isInteger(row.defenseCount) && row.defenseCount > 0
    ? row.defenseStars / row.defenseCount : null;
}

// Rank by defense trophies (high first); ties go to fewer stars taken per defense, then the official rank.
export function defenseRanks(standings = [], trophyMode) {
  if (trophyMode === "lost" || trophyMode === "mixed") return new Map();
  const ranked = standings.filter((row) => row?.playerTag && Number.isFinite(row.defenseTrophies));
  ranked.sort((a, b) => b.defenseTrophies - a.defenseTrophies
    || (averageStarsTaken(a) ?? Infinity) - (averageStarsTaken(b) ?? Infinity)
    || (finite(a.rank) ?? Infinity) - (finite(b.rank) ?? Infinity));
  return new Map(ranked.map((row, index) => [row.playerTag, index + 1]));
}

export function defenseAverageStars(row) {
  return averageStarsTaken(row);
}

export function myAttacksByOpponent(battleViews) {
  const byOpponent = new Map();
  for (const battle of battleViews?.attacks ?? []) {
    if (!battle?.opponentTag) continue;
    const list = byOpponent.get(battle.opponentTag) ?? [];
    list.push({
      stars: battle.stars,
      destruction: battle.destruction,
      trophies: finite(battle.trophyDelta) ?? finite(battle.trophies),
      timestamp: battle.battleTimestamp || battle.timestamp || "",
    });
    byOpponent.set(battle.opponentTag, list);
  }
  for (const list of byOpponent.values()) list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return byOpponent;
}

export function attackEquipmentIds(army) {
  const ids = new Set();
  for (const hero of army?.heroes ?? []) {
    for (const gear of hero?.equipment ?? []) {
      if (Number.isInteger(gear?.id)) ids.add(gear.id);
    }
  }
  return ids;
}

export function weekWinRate(standing) {
  const wins = standing?.attackWins;
  const losses = standing?.attackLosses;
  return Number.isInteger(wins) && Number.isInteger(losses) && wins + losses > 0 ? wins / (wins + losses) : null;
}

export function playerStrategyStats(attacks = []) {
  const groups = new Map();
  for (const attack of attacks) {
    if (!attack || typeof attack !== "object" || Array.isArray(attack)) continue;
    const label = typeof attack.strategy === "string" ? attack.strategy.trim() : "";
    const strategy = label && !/^(?:未分类|未识别(?:流派)?|未知|unknown|unclassified)$/i.test(label) ? label : null;
    const stats = groups.get(strategy) ?? {
      strategy, count: 0, scoredCount: 0, threeStarCount: 0, destructionCount: 0, destructionTotal: 0,
    };
    stats.count += 1;
    if (Number.isInteger(attack.stars) && attack.stars >= 0 && attack.stars <= 3) {
      stats.scoredCount += 1;
      stats.threeStarCount += Number(attack.stars === 3);
    }
    if (Number.isFinite(attack.destruction) && attack.destruction >= 0 && attack.destruction <= 100) {
      stats.destructionCount += 1;
      stats.destructionTotal += attack.destruction;
    }
    groups.set(strategy, stats);
  }
  return [...groups.values()].map(({ destructionTotal, ...stats }) => ({
    ...stats,
    threeStarRate: stats.scoredCount ? stats.threeStarCount / stats.scoredCount : null,
    averageDestruction: stats.destructionCount ? destructionTotal / stats.destructionCount : null,
  })).sort((a, b) => b.count - a.count
    || Number(a.strategy === null) - Number(b.strategy === null)
    || (a.strategy ?? "").localeCompare(b.strategy ?? "", "zh-CN"));
}

function carriedTotal(item) {
  return item.players.reduce((sum, player) => sum + player.carried, 0);
}

function heroOrder(id) {
  const index = HERO_ORDER.indexOf(id);
  return index === -1 ? HERO_ORDER.length : index;
}

export const MAX_FILTER_HEROES = 4;
export const MAX_GEAR_PER_HERO = 2;

// Per-player results over a set of attacks, joined with the official weekly win/loss counts.
export function playerStats(attacks = [], standings = []) {
  const standingByTag = new Map(standings.map((row) => [row.playerTag, row]));
  const players = new Map();
  for (const attack of attacks) {
    if (!attack?.playerTag) continue;
    const player = players.get(attack.playerTag) ?? {
      playerTag: attack.playerTag,
      playerName: attack.playerName || standingByTag.get(attack.playerTag)?.playerName || "",
      carried: 0, threeStars: 0, starTotal: 0, starCount: 0, destructionTotal: 0, destructionCount: 0,
      attackIds: [],
    };
    player.carried += 1;
    player.attackIds.push(attack.id);
    if (Number.isInteger(attack.stars)) {
      player.starCount += 1;
      player.starTotal += attack.stars;
      player.threeStars += Number(attack.stars === 3);
    }
    if (Number.isFinite(attack.destruction)) {
      player.destructionCount += 1;
      player.destructionTotal += attack.destruction;
    }
    players.set(attack.playerTag, player);
  }
  return [...players.values()].map(({ starTotal, starCount, destructionTotal, destructionCount, ...player }) => {
    const standing = standingByTag.get(player.playerTag);
    return {
      ...player,
      scored: starCount,
      threeStarRate: starCount ? player.threeStars / starCount : null,
      averageStars: starCount ? starTotal / starCount : null,
      averageDestruction: destructionCount ? destructionTotal / destructionCount : null,
      attackWins: standing?.attackWins ?? null,
      attackLosses: standing?.attackLosses ?? null,
      weekWinRate: weekWinRate(standing),
    };
  }).sort((a, b) => b.carried - a.carried || (b.threeStarRate ?? -1) - (a.threeStarRate ?? -1)
    || a.playerTag.localeCompare(b.playerTag));
}

// Equipment carried in this week's group attacks, grouped under the hero that wore it.
export function equipmentUsage(attacks = [], standings = []) {
  const items = new Map();
  for (const attack of attacks) {
    if (!attack?.playerTag) continue;
    for (const hero of attack.army?.heroes ?? []) {
      for (const gear of hero?.equipment ?? []) {
        if (!Number.isInteger(gear?.id)) continue;
        const item = items.get(gear.id) ?? {
          id: gear.id,
          name: gear.displayName || gear.name || `装备 #${gear.id}`,
          heroId: Number.isInteger(hero.id) ? hero.id : null,
          heroName: hero.displayName || hero.name || "",
          attacks: [],
        };
        if (item.attacks.at(-1) !== attack) item.attacks.push(attack);
        items.set(gear.id, item);
      }
    }
  }

  return [...items.values()].map(({ attacks: carried, ...item }) => ({
    ...item, players: playerStats(carried, standings),
  })).sort((a, b) => heroOrder(a.heroId) - heroOrder(b.heroId)
    || b.players.length - a.players.length || carriedTotal(b) - carriedTotal(a)
    || a.name.localeCompare(b.name, "zh-CN"));
}

// Equipment grouped by hero, in hero order, for the filter picker.
export function equipmentByHero(usage) {
  const heroes = [];
  for (const item of usage) {
    const last = heroes.at(-1);
    if (last && last.heroId === item.heroId) last.items.push(item);
    else heroes.push({ heroId: item.heroId, heroName: item.heroName || "其他英雄", items: [item] });
  }
  return heroes;
}

// Attacks that carried every selected equipment (all at once, in the same attack).
export function attacksWithEquipment(attacks = [], ids = []) {
  if (!ids.length) return [];
  return attacks.filter((attack) => {
    const carried = attackEquipmentIds(attack?.army);
    return ids.every((id) => carried.has(id));
  });
}

// Merge repeated units and sort by id, so the order units were deployed in does not matter.
function canonicalUnits(units) {
  const merged = new Map();
  for (const unit of Array.isArray(units) ? units : []) {
    const key = unit?.id ?? unit?.name;
    if (key == null) continue;
    const count = unit.count ?? 1;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, count: existing.count + count } : { ...unit, count });
  }
  return [...merged.values()].sort((a, b) => (a.id ?? Infinity) - (b.id ?? Infinity)
    || String(a.name).localeCompare(String(b.name)));
}

// Group by camp and castle composition, showing the newest hero loadout in each group.
export function armySets(attacks = []) {
  const sets = new Map();
  for (const attack of attacks) {
    const army = attack?.army;
    if (!army?.troops?.length) continue;
    const units = {
      troops: canonicalUnits(army.troops),
      spells: canonicalUnits(army.spells),
      siegeMachines: canonicalUnits(army.siegeMachines),
      clanCastleTroops: canonicalUnits(army.clanCastleTroops ?? army.reinforcements),
      clanCastleSpells: canonicalUnits(army.clanCastleSpells ?? army.reinforcementSpells),
      clanCastleSiegeMachines: canonicalUnits(army.clanCastleSiegeMachines),
    };
    const key = JSON.stringify(Object.values(units).map((items) => items.map(({ id, name, count }) => [id ?? name, count])));
    const set = sets.get(key) ?? {
      key,
      count: 0, threeStars: 0, starTotal: 0, starCount: 0, destructionTotal: 0, destructionCount: 0,
    };
    const time = finite(Date.parse(attack.battleTimestamp || attack.timestamp)) ?? -Infinity;
    if (!set.army || time > set.time) {
      set.time = time;
      set.army = {
        ...army,
        ...units,
        heroes: [...(army.heroes ?? [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
      };
    }
    set.count += 1;
    if (Number.isInteger(attack.stars)) {
      set.starCount += 1;
      set.starTotal += attack.stars;
      set.threeStars += Number(attack.stars === 3);
    }
    if (Number.isFinite(attack.destruction)) {
      set.destructionCount += 1;
      set.destructionTotal += attack.destruction;
    }
    sets.set(key, set);
  }
  return [...sets.values()].map(({ time, starTotal, starCount, destructionTotal, destructionCount, ...set }) => ({
    ...set,
    averageStars: starCount ? starTotal / starCount : null,
    averageDestruction: destructionCount ? destructionTotal / destructionCount : null,
  })).sort((a, b) => b.count - a.count || (b.averageStars ?? -1) - (a.averageStars ?? -1));
}
