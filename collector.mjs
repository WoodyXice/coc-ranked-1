import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const apiRoot = 'https://api.clashofclans.com/v1';
const day = 86_400_000;
const rankedWeekStartOffset = 5 * 3_600_000;
const matchWindow = 180_000;
const snapshotWrites = new Map();

// Share codes use the low digits of the game object IDs. Names and housing
// sizes come from the pinned clashy.go v0.1.21 game data catalog.
// https://github.com/ClashKingInc/clashy.go/blob/v0.1.21/static/static_data.json
const troopData = {
  0: ['Barbarian', 1], 1: ['Archer', 1], 2: ['Goblin', 1], 3: ['Giant', 5],
  4: ['Wall Breaker', 2], 5: ['Balloon', 5], 6: ['Wizard', 4], 7: ['Healer', 14],
  8: ['Dragon', 20], 9: ['P.E.K.K.A', 25], 10: ['Minion', 2], 11: ['Hog Rider', 5],
  12: ['Valkyrie', 8], 13: ['Golem', 30], 15: ['Witch', 12], 17: ['Lava Hound', 30],
  22: ['Bowler', 6], 23: ['Baby Dragon', 10], 24: ['Miner', 6], 26: ['Super Barbarian', 5],
  27: ['Super Archer', 12], 28: ['Super Wall Breaker', 8], 29: ['Super Giant', 10],
  30: ['Ice Wizard', 4], 45: ['Battle Ram', 4], 47: ['Royal Ghost', 8],
  48: ['Pumpkin Barbarian', 1], 50: ['Giant Skeleton', 20], 53: ['Yeti', 18],
  55: ['Sneaky Goblin', 3], 56: ['Super Miner', 24], 57: ['Rocket Balloon', 8],
  58: ['Ice Golem', 15], 59: ['Electro Dragon', 30], 61: ['Skeleton Barrel', 5],
  63: ['Inferno Dragon', 15], 64: ['Super Valkyrie', 20], 65: ['Dragon Rider', 25],
  66: ['Super Witch', 40], 67: ['M.E.C.H.A', 10], 72: ['Party Wizard', 4],
  76: ['Ice Hound', 40], 80: ['Super Bowler', 30], 81: ['Super Dragon', 40],
  82: ['Headhunter', 6], 83: ['Super Wizard', 10], 84: ['Super Minion', 12],
  94: ['Ram Rider', 12], 95: ['Electro Titan', 32], 97: ['Apprentice Warden', 20],
  98: ['Super Hog Rider', 12], 101: ['Barcher', 3], 102: ['Witch Golem', 41],
  103: ['Hog Wizard', 7], 104: ['Lavaloon', 21], 109: ['Ruin Witch', 26],
  110: ['Root Rider', 20], 118: ['C.O.O.K.I.E', 10], 119: ['Firecracker', 10],
  120: ['Azure Dragon', 40], 121: ['Barbarian Kicker', 12], 122: ['Giant Thrower', 15],
  123: ['Druid', 16], 125: ['Broom Witch', 20], 130: ['Ice Minion', 4],
  132: ['Thrower', 16], 136: ['Debt Collector', 4], 142: ['Snake Barrel', 8],
  147: ['Super Yeti', 35], 150: ['Furnace', 18], 156: ['Giant Giant', 50],
  157: ['K.A.N.E', 75], 158: ['The Disarmer', 60], 159: ['YEETer', 45],
  167: ['Meteor Golem', 40], 177: ['Meteor Golem', 40], 185: ['Elephant Rider', 24],
  190: ['Yeti Undertaker', 80], 194: ['Totem Thrower', 28], 195: ['Barch Squad', 15],
  196: ['Giant Wizard Squad', 25], 197: ['Wall Breaker Squad', 8], 198: ['Minion Squad', 12],
  199: ['Balloon Squad', 16], 200: ['Golem Witch Squad', 55], 201: ['Hog Rider Squad', 48],
  202: ['Miner Squad', 48], 203: ['Healer Squad', 70], 204: ['P.E.K.K.A Titan Squad'],
  205: ['Dragons Squad', 85], 206: ['Baby Dragon Squad'],
};
const siegeNames = {
  51: 'Wall Wrecker', 52: 'Battle Blimp', 62: 'Stone Slammer', 75: 'Siege Barracks',
  87: 'Log Launcher', 91: 'Flame Flinger', 92: 'Battle Drill', 135: 'Troop Launcher',
  188: 'Sky Wagon',
};
const spellNames = {
  0: 'Lightning Spell', 1: 'Healing Spell', 2: 'Rage Spell', 3: 'Jump Spell',
  5: 'Freeze Spell', 6: "Santa's Surprise", 9: 'Poison Spell', 10: 'Earthquake Spell',
  11: 'Haste Spell', 16: 'Clone Spell', 17: 'Skeleton Spell', 28: 'Bat Spell',
  35: 'Invisibility Spell', 53: 'Recall Spell', 70: 'Overgrowth Spell',
  73: 'Bag of Frostmites', 98: 'Revive Spell', 109: 'Ice Block Spell',
  120: 'Totem Spell', 123: 'Angry Spell', 153: 'Heroic Spell',
};
const heroNames = {
  0: 'Barbarian King', 1: 'Archer Queen', 2: 'Grand Warden', 4: 'Royal Champion',
  6: 'Minion Prince', 7: 'Dragon Duke',
};
const petNames = {
  0: 'L.A.S.S.I', 1: 'Mighty Yak', 2: 'Electro Owl', 3: 'Unicorn', 4: 'Phoenix',
  7: 'Poison Lizard', 8: 'Diggy', 9: 'Frosty', 10: 'Spirit Fox', 11: 'Angry Jelly',
  16: 'Sneezy', 17: 'Greedy Raven',
};
const equipmentNames = {
  0: 'Barbarian Puppet', 1: 'Rage Vial', 2: 'Archer Puppet', 3: 'Invisibility Vial',
  4: 'Eternal Tome', 5: 'Life Gem', 6: 'Seeking Shield', 7: 'Royal Gem',
  8: 'Earthquake Boots', 9: 'Hog Rider Puppet', 10: 'Giant Gauntlet', 11: 'Vampstache',
  12: 'Haste Vial', 13: 'Rocket Spear', 14: 'Spiky Ball', 15: 'Frozen Arrow',
  16: 'Monolith Arrow', 17: 'Giant Arrow', 19: 'Heroic Torch', 20: 'Healer Puppet',
  22: 'Fireball', 24: 'Rage Gem', 32: 'Snake Bracelet', 34: 'Healing Tome',
  35: 'Dark Crown', 39: 'Magic Mirror', 40: 'Electro Boots', 41: 'Lavaloon Puppet',
  42: 'Henchmen Puppet', 43: 'Dark Orb', 44: 'Metal Pants', 47: 'Noble Iron',
  48: 'Action Figure', 49: 'Meteor Staff', 50: 'Frost Flake', 51: 'Stick Horse',
  52: 'Fire Heart', 53: 'Rocket Backpack', 56: 'Stun Blaster', 57: 'Flame Blower',
  59: 'Electro Fangs', 60: 'Revenge Deck', 61: 'Portal Pendant',
};

// Simplified Chinese names are transcribed from the same catalog's CN strings.
// https://github.com/ClashKingInc/clashy.go/blob/v0.1.21/static/translations.json
const chineseTroops = {
  0: '野蛮人', 1: '弓箭手', 2: '哥布林', 3: '巨人', 4: '炸弹人', 5: '气球兵',
  6: '法师', 7: '天使', 8: '飞龙', 9: '皮卡超人', 10: '亡灵', 11: '野猪骑士',
  12: '瓦基丽武神', 13: '戈仑石人', 15: '女巫', 17: '熔岩猎犬', 22: '巨石投手',
  23: '飞龙宝宝', 24: '掘地矿工', 26: '超级野蛮人', 27: '超级弓箭手',
  28: '超级炸弹人', 29: '超级巨人', 30: '寒冰法师', 45: '野蛮人攻城槌',
  47: '皇家幽灵', 48: '南瓜野蛮人', 50: '骷髅巨人', 51: '攻城战车', 52: '攻城飞艇',
  53: '大雪怪', 55: '隐秘哥布林', 56: '超级矿工', 57: '火箭气球兵', 58: '戈仑冰人',
  59: '雷电飞龙', 61: '骷髅飞桶', 62: '攻城气球', 63: '地狱飞龙',
  64: '超级瓦基丽武神', 65: '龙骑士', 66: '超级女巫', 67: '机甲超人',
  72: '派对法师', 75: '攻城训练营', 76: '寒冰猎犬', 80: '超级巨石投手',
  81: '超级飞龙', 82: '英雄猎手', 83: '超级法师', 84: '超级亡灵', 87: '攻城滚木车',
  91: '攻城烈焰车', 92: '攻城钻机', 94: '蛮羊骑士', 95: '雷霆泰坦',
  97: '守护者学徒', 98: '超级野猪骑士', 101: '野蛮箭手', 102: '女巫戈仑',
  103: '野猪法师', 104: '熔岩气球', 109: '废墟女巫', 110: '根蔓骑士',
  118: '饼干皮卡', 119: '烟花炮手', 120: '驭水青龙', 121: '任意球野蛮人',
  122: '边线球巨人', 123: '德鲁伊', 125: '扫帚女巫', 130: '寒冰亡灵',
  132: '巨矛投手', 135: '部队发射器', 136: '收债哥布林', 142: '灵蛇飞桶',
  147: '超级大雪怪', 150: '烈焰熔炉', 156: '霸天巨人', 157: '皮卡凯恩',
  158: '铁臂终结者', 159: '战吼狂人', 167: '陨石戈仑', 177: '陨石戈仑',
  185: '大象骑士', 188: '空中战车', 190: '送葬者大雪怪', 194: '图腾投手',
  195: '野蛮人弓箭手小队', 196: '巨人法师小队', 197: '炸弹人小队',
  198: '亡灵小队', 199: '气球兵小队', 200: '女巫戈仑小队', 201: '野猪骑士小队',
  202: '掘地矿工小队', 203: '天使小队', 204: '皮卡泰坦小队', 205: '飞龙小队',
  206: '飞龙宝宝小队',
};
const chineseSpells = {
  0: '雷电法术', 1: '疗伤法术', 2: '狂暴法术', 3: '弹跳法术', 5: '冰冻法术',
  6: '圣诞奇袭', 9: '伤害药水法术', 10: '地震法术', 11: '急速法术', 16: '镜像法术',
  17: '骷髅法术', 28: '蝙蝠法术', 35: '隐形法术', 53: '回溯法术', 70: '疯狂蔓生法术',
  73: '袋装小冰怪', 98: '复苏法术', 109: '冰障法术', 120: '图腾法术',
  123: '愤怒法术', 153: '英勇法术',
};
const chineseHeroes = {
  0: '野蛮人之王', 1: '弓箭女皇', 2: '大守护者', 4: '飞盾战神', 6: '亡灵王子', 7: '飞龙公爵',
};
const chinesePets = {
  0: '莱希', 1: '大牦', 2: '闪枭', 3: '独角', 4: '凤凰', 7: '猛蜥', 8: '地兽',
  9: '冰牙', 10: '灵狐', 11: '愤怒水母', 16: '阿啾', 17: '贪婪渡鸦',
};
const chineseEquipment = {
  0: '野蛮人木偶', 1: '狂暴药水瓶', 2: '弓箭手木偶', 3: '隐形药水瓶', 4: '永恒书卷',
  5: '生命宝石', 6: '寻踪飞盾', 7: '皇家宝石', 8: '地震金靴', 9: '野猪骑士木偶',
  10: '巨型手套', 11: '治疗胡须', 12: '急速药水瓶', 13: '火箭飞矛', 14: '尖刺足球',
  15: '冰封箭矢', 16: '擎天箭矢', 17: '巨型箭矢', 19: '英雄火炬', 20: '天使木偶',
  22: '巨大火球', 24: '狂暴宝石', 32: '灵蛇手镯', 34: '治疗书卷', 35: '暗黑皇冠',
  39: '克隆魔镜', 40: '雷电战靴', 41: '熔岩气球玩偶', 42: '护卫玩偶', 43: '暗黑魔球',
  44: '铁甲短裤', 47: '贵族哑铃', 48: '动作人偶', 49: '陨石法杖', 50: '冷冽冰晶',
  51: '木棍马驹', 52: '烈焰之心', 53: '火箭背包', 56: '爆震器', 57: '助燃器',
  59: '雷电獠牙', 60: '反击卡组', 61: '传送吊坠',
};

function shareCode(value) {
  return typeof value === 'string' && value.trim().length <= 8192 ? value.trim() : '';
}

function namedUnit(id, name, chineseName) {
  return { id, name, displayName: chineseName ?? name };
}

// The share link's i/d sections record Clan Castle troops and spells.
// https://github.com/ClashKingInc/clashy.go/blob/v0.1.21/game.go
export function decodeArmyShareCode(value) {
  let code = shareCode(value);
  if (!code) return null;

  try {
    if (code.includes('?')) {
      code = new URL(code, 'https://link.clashofclans.com').searchParams.get('army') ?? '';
    } else {
      code = decodeURIComponent(code);
    }
  } catch {
    return null;
  }

  const troops = [];
  const siegeMachines = [];
  const spells = [];
  const heroes = [];
  const clanCastleTroops = [];
  const clanCastleSpells = [];
  const clanCastleSiegeMachines = [];
  for (const [, section, payload] of code.toLowerCase().matchAll(/([hidus])([0-9x_mpe-]+)/g)) {
    for (const item of payload.split('-')) {
      if (section === 'h') {
        const hero = /^(\d+)(?:m\d+)?(?:p(\d+))?(?:e(\d+)(?:_(\d+))?)?$/.exec(item);
        if (!hero) continue;
        const id = Number(hero[1]);
        const petId = hero[2] === undefined ? null : Number(hero[2]);
        const equipment = hero.slice(3, 5).filter(Boolean).map(Number)
          .map((key) => namedUnit(key, equipmentNames[key] ?? `装备 #${key}`, chineseEquipment[key]));
        const pet = petId === null
          ? undefined : namedUnit(petId, petNames[petId] ?? `战宠 #${petId}`, chinesePets[petId]);
        heroes.push({
          ...namedUnit(id, heroNames[id] ?? `英雄 #${id}`, chineseHeroes[id]),
          equipment,
          ...(pet ? { pet } : {}),
        });
        continue;
      }

      const unit = /^(\d{1,3})x(\d{1,6})$/.exec(item);
      if (!unit) continue;
      const count = Number(unit[1]);
      const id = Number(unit[2]);
      if (!count) continue;
      if (section === 's' || section === 'd') {
        const target = section === 's' ? spells : clanCastleSpells;
        target.push({ ...namedUnit(id, spellNames[id] ?? `法术 #${id}`, chineseSpells[id]), count });
      } else if (siegeNames[id]) {
        const target = section === 'u' ? siegeMachines : clanCastleSiegeMachines;
        target.push({ ...namedUnit(id, siegeNames[id], chineseTroops[id]), count });
      } else {
        const target = section === 'u' ? troops : clanCastleTroops;
        const [name, housingSpace] = troopData[id] ?? [`兵种 #${id}`];
        target.push({ ...namedUnit(id, name, chineseTroops[id]), count, housingSpace });
      }
    }
  }
  const army = { troops, siegeMachines, spells, heroes, clanCastleTroops, clanCastleSpells, clanCastleSiegeMachines };
  return Object.values(army).some((units) => units.length) ? army : null;
}

function clientError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeTag(value) {
  const tag = typeof value === 'string' ? value.trim().toUpperCase().replace(/^#/, '') : '';
  return /^[A-Z0-9]{2,20}$/.test(tag) ? `#${tag}` : '';
}

function timestamp(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const epoch = Number(value);
    return epoch < 1e12 ? epoch * 1000 : epoch;
  }
  if (typeof value !== 'string') return NaN;
  const iso = value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/i,
    (_, year, month, date, hour, minute, second, fraction = '') =>
      `${year}-${month}-${date}T${hour}:${minute}:${second}${fraction}Z`,
  );
  return /(?:Z|[+-]\d\d:\d\d)$/i.test(iso) ? Date.parse(iso) : NaN;
}

function weekMonday(epoch) {
  const date = new Date(epoch);
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(epoch - offset * day).toISOString().slice(0, 10);
}

function findLeagueGroup(player, week, requestedGroup) {
  const choices = ['current', 'previous'].flatMap((period) => {
    const groupTag = normalizeTag(player[`${period}LeagueGroupTag`]);
    const seasonId = Number(player[`${period}LeagueSeasonId`]);
    if (!groupTag || !Number.isSafeInteger(seasonId) || seasonId < 1e9 || seasonId >= 1e10) return [];
    return [{ groupTag, seasonId, week: weekMonday(seasonId * 1000) }];
  });
  return choices.find((choice) => (!week || choice.week === week)
    && (!requestedGroup || choice.groupTag === requestedGroup));
}

function authorizationError(payload) {
  const reason = typeof payload?.reason === 'string' ? payload.reason.toLowerCase() : '';
  const message = typeof payload?.message === 'string' ? payload.message : '';
  if (reason === 'accessdenied.invalidip' || /does not allow access from IP\b/i.test(message)) {
    const address = message.match(/\bIP(?: address)?[:\s]+\[?([\da-f:.]+)/i)?.[1]?.replace(/\.$/, '');
    const origin = address && isIP(address) ? ` ${address}` : '';
    return clientError(403, `本机公网出口 IP${origin}未获官方授权。请创建允许该 IP 的开发者密钥，再到「管理令牌」替换。`);
  }
  if (/^missing authorization\.?$/i.test(message.trim())) {
    return clientError(403, '官方 API 未识别到开发者密钥。请在「管理令牌」重新保存开发者 API 密钥。');
  }
  return clientError(403, '官方 API 未接受当前开发者密钥。请检查密钥是否有效，以及是否允许本机公网出口 IP。');
}

function apiRequest(token, fetchImpl, interval) {
  let nextRequestAt = 0;
  let retryAt = 0;

  return async function request(path) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = Date.now();
      const start = Math.max(now, nextRequestAt, retryAt);
      nextRequestAt = start + interval;
      if (start > now) await delay(start - now);

      let response;
      try {
        response = await fetchImpl(apiRoot + path, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.timeout(12_000),
        });
      } catch {
        if (attempt === 2) throw clientError(502, '无法连接 Clash of Clans 官方 API。');
        await delay(500 * (attempt + 1));
        continue;
      }

      if (response.ok) {
        try {
          const body = await response.json();
          if (body && typeof body === 'object') return body;
        } catch {
          // Handled like a bad upstream response below.
        }
        throw clientError(502, '官方 API 返回了无法读取的数据。');
      }

      const { status } = response;
      const retryHeader = response.headers?.get('retry-after');
      if (status === 401 || status === 403) {
        const problem = await response.json().catch(() => null);
        throw authorizationError(problem);
      }
      await response.body?.cancel().catch(() => {});
      if (status === 404) throw clientError(404, '官方 API 找不到该玩家、排位小组或战斗日志。');
      if (status === 400) throw clientError(400, '官方 API 拒绝了玩家或排位小组参数。');
      if (status === 429 || status >= 500) {
        if (attempt === 2) {
          if (status === 429) throw clientError(429, '官方 API 请求频率受限，请稍后重新抓取。');
          throw clientError(502, '官方 API 暂时不可用，请稍后重试。');
        }
        const retrySeconds = Number(retryHeader);
        const wait = retryHeader && Number.isFinite(retrySeconds)
          ? retrySeconds * 1000
          : Math.max(Date.parse(retryHeader) - Date.now() || 0, 700 * (2 ** attempt));
        retryAt = Math.max(retryAt, Date.now() + Math.min(Math.max(100, wait), 10_000));
        continue;
      }
      throw clientError(502, '官方 API 返回了意外的响应。');
    }
    throw clientError(502, '官方 API 请求未完成。');
  };
}

async function inBatches(items, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const work = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { value: await fn(items[index]) };
      } catch (error) {
        results[index] = { status: error.status ?? 502 };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, work));
  return results;
}

function groupBattlePath(groupTag, seasonId, playerTag) {
  return `/leaguegroup/${encodeURIComponent(groupTag)}/${seasonId}?playerTag=${encodeURIComponent(playerTag)}`;
}

function playerPath(playerTag) {
  return `/players/${encodeURIComponent(playerTag)}`;
}

function battleScore(row) {
  const stars = row.stars;
  const destruction = row.destructionPercentage;
  return Number.isInteger(stars) && stars >= 0 && stars <= 3
    && Number.isInteger(destruction) && destruction >= 0 && destruction <= 100
    ? { stars, destruction }
    : null;
}

function battleMode(value) {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z]/g, '') : '';
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rankedBattleTrophies(value) {
  return Number.isInteger(value) && Math.abs(value) <= 40 ? Math.abs(value) : null;
}

// Legend I uses the stars/destruction schedule published by Supercell.
// https://supercell.com/en/games/clashofclans/ja/blog/game-updates/legend-league-redesign-jp/
function attackerTrophies(stars, destruction) {
  switch (stars) {
    case 3: return 40;
    case 2: return 16 + Math.min(16, Math.max(0, Math.floor((destruction - 50) / 3)));
    case 1: return 5 + Math.min(10, Math.max(0, Math.floor((destruction - 1) / 9)));
    default: return Math.min(4, Math.floor(destruction / 10));
  }
}

function usableShareCode(value) {
  const code = shareCode(value);
  return decodeArmyShareCode(code) ? code : '';
}

const armySourceRank = { group: 3, attack: 2, defense: 1 };

function betterArmy(candidate, recorded) {
  if (!candidate.armyShareCode) return false;
  if (!recorded.armyShareCode) return true;
  if (candidate.armyShareCode !== recorded.armyShareCode) {
    const candidateTroops = !!decodeArmyShareCode(candidate.armyShareCode)?.troops.length;
    const recordedTroops = !!decodeArmyShareCode(recorded.armyShareCode)?.troops.length;
    if (candidateTroops !== recordedTroops) return candidateTroops;
  }
  return (armySourceRank[candidate.armySource] ?? 0) > (armySourceRank[recorded.armySource] ?? 0);
}

function memberBattleCount(win, loss) {
  const wins = nonnegativeInteger(win);
  const losses = nonnegativeInteger(loss);
  return wins === null && losses === null ? null : (wins ?? 0) + (losses ?? 0);
}

const memberAttackCount = (member) => memberBattleCount(member.attackWinCount, member.attackLoseCount);
const memberDefenseCount = (member) => memberBattleCount(member.defenseWinCount, member.defenseLoseCount);

function groupBattle(row, member, isDefense = false) {
  const otherTag = normalizeTag(row.opponentPlayerTag);
  const epoch = timestamp(row.creationTime);
  const score = battleScore(row);
  if (!otherTag || !Number.isFinite(epoch) || !score) return null;
  const armyShareCode = usableShareCode(row.armyShareCode);
  const playerTag = isDefense ? otherTag : member.playerTag;
  const playerName = isDefense ? row.opponentName : member.playerName;
  const opponentTag = isDefense ? member.playerTag : otherTag;
  const opponentName = isDefense ? member.playerName : row.opponentName;
  return {
    id: [playerTag, opponentTag, epoch, score.stars, score.destruction].join('|'),
    playerTag,
    playerName,
    opponentTag,
    opponentName,
    timestamp: new Date(epoch).toISOString(),
    ...score,
    trophies: rankedBattleTrophies(row.trophies),
    durationSeconds: nonnegativeInteger(row.battleTime),
    armyShareCode,
    ...(armyShareCode ? { armySource: 'group' } : {}),
  };
}

function readGroupBattles(rows, member, isDefense = false) {
  const battles = new Map();
  let malformed = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const battle = row && groupBattle(row, member, isDefense);
    if (!battle) {
      malformed += 1;
      continue;
    }
    const recorded = battles.get(battle.id);
    battles.set(battle.id, recorded ? {
      ...mergeBattleDetails(battle, recorded),
      trophies: battle.trophies ?? recorded.trophies,
    } : battle);
  }
  return { rows: [...battles.values()], malformed, present: Array.isArray(rows) };
}

function timingSummary(rows) {
  const durations = rows.map((row) => row.durationSeconds).filter(Number.isFinite);
  const lastAt = rows.reduce((latest, row) => (!latest || row.timestamp > latest ? row.timestamp : latest), null);
  return {
    durationCount: durations.length,
    durationAverage: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
    lastAt,
  };
}

function summarizeStandingSide(ledger, expected) {
  const { rows, malformed, present } = ledger;
  const count = expected ?? (present && !malformed ? rows.length : null);
  const timing = timingSummary(rows);
  const complete = count !== null && count === rows.length && !malformed && (present || count === 0);
  if (!complete) return { count, stars: null, destruction: null, trophies: null, threeStars: null, ...timing };

  const stars = rows.reduce((total, row) => total + row.stars, 0);
  const destruction = count ? rows.reduce((total, row) => total + row.destruction, 0) / count : null;
  const trophies = rows.every((row) => Number.isFinite(row.trophies))
    ? rows.reduce((total, row) => total + row.trophies, 0)
    : null;
  const threeStars = rows.filter((row) => row.stars === 3).length;
  return { count, stars, destruction, trophies, threeStars, ...timing };
}

function buildStanding(member, rank, attacks, defenses, trophies, wins = null) {
  return {
    rank,
    playerTag: member.playerTag,
    playerName: member.playerName ?? member.playerTag,
    attackCount: attacks.count,
    defenseCount: defenses.count,
    attackStars: attacks.stars,
    defenseStars: defenses.stars,
    attackDestruction: attacks.destruction,
    defenseDestruction: defenses.destruction,
    attackTrophies: attacks.trophies,
    defenseTrophies: defenses.trophies,
    defenseThreeStars: defenses.threeStars ?? null,
    attackWins: wins?.attackWins ?? null,
    attackLosses: wins?.attackLosses ?? null,
    trophies,
    attackDurationAverage: attacks.durationAverage,
    defenseDurationAverage: defenses.durationAverage,
    attackDurationCount: attacks.durationCount,
    defenseDurationCount: defenses.durationCount,
    lastAttackAt: attacks.lastAt,
    lastDefenseAt: defenses.lastAt,
  };
}

function groupStanding(member, attackLedger, defenseLedger) {
  const attacks = summarizeStandingSide(attackLedger, memberAttackCount(member));
  const defenses = summarizeStandingSide(defenseLedger, memberDefenseCount(member));
  const trophies = nonnegativeInteger(member.leagueTrophies)
    ?? (attacks.trophies !== null && defenses.trophies !== null ? attacks.trophies + defenses.trophies : null);
  return buildStanding(member, member.rank ?? null, attacks, defenses, trophies, {
    attackWins: nonnegativeInteger(member.attackWinCount),
    attackLosses: nonnegativeInteger(member.attackLoseCount),
  });
}

function pairKey(attack) {
  return [attack.playerTag, attack.opponentTag, attack.stars, attack.destruction].join('|');
}

function indexBattleViews(items, owner, indexes) {
  for (const row of items) {
    if (!row || (row.attack !== true && row.attack !== false) || battleMode(row.battleType) !== 'RANKED') continue;
    const opponent = normalizeTag(row.opponentPlayerTag);
    const armyShareCode = usableShareCode(row.armyShareCode);
    const epoch = timestamp(row.battleTimestamp);
    const score = battleScore(row);
    if (!opponent || !Number.isFinite(epoch) || !score) continue;
    const playerTag = row.attack ? owner : opponent;
    const opponentTag = row.attack ? opponent : owner;
    const index = row.attack ? indexes.attack : indexes.defense;
    const key = pairKey({ playerTag, opponentTag, ...score });
    const bucket = index.get(key) ?? new Map();
    const detail = {
      epoch, armyShareCode,
      armySource: armyShareCode ? (row.attack ? 'attack' : 'defense') : undefined,
      durationSeconds: nonnegativeInteger(row.battleTime),
      battleTimestamp: new Date(epoch).toISOString(),
    };
    const existing = bucket.get(epoch);
    bucket.set(epoch, existing ? mergeBattleDetails(existing, detail) : detail);
    index.set(key, bucket);
  }
}

function nearest(target, entries) {
  let best;
  let bestDistance = matchWindow + 1;
  for (const entry of entries) {
    const distance = Math.abs(target - entry.epoch);
    if (distance === bestDistance) {
      best = undefined;
    } else if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

function groupByPair(battles) {
  const buckets = new Map();
  for (const battle of battles) {
    const key = pairKey(battle);
    const bucket = buckets.get(key) ?? [];
    bucket.push({ epoch: Date.parse(battle.timestamp), battle });
    buckets.set(key, bucket);
  }
  return buckets;
}

function groupByOwner(battles, ownerField) {
  const byOwner = new Map();
  for (const battle of battles) {
    const owner = battle[ownerField];
    const entries = byOwner.get(owner) ?? [];
    entries.push(battle);
    byOwner.set(owner, entries);
  }
  return byOwner;
}

function mergeBattleDetails(recorded, candidate) {
  const army = betterArmy(candidate, recorded)
    ? { armyShareCode: candidate.armyShareCode, armySource: candidate.armySource }
    : {};
  return {
    ...recorded,
    ...army,
    durationSeconds: recorded.durationSeconds ?? candidate.durationSeconds ?? null,
    battleTimestamp: recorded.battleTimestamp ?? candidate.battleTimestamp,
  };
}

function joinBattleDetails(battles, views) {
  for (const [key, bucket] of groupByPair(battles)) {
    for (const entry of bucket) {
      for (const index of [views.attack, views.defense]) {
        const match = nearest(entry.epoch, index.get(key)?.values() ?? []);
        if (!match || nearest(match.epoch, bucket) !== entry) continue;
        Object.assign(entry.battle, mergeBattleDetails(entry.battle, match));
      }
    }
  }
}

function reuseGroupBattleDetails(battles, groupAttacks) {
  const group = groupByPair(groupAttacks);
  for (const [key, bucket] of groupByPair(battles)) {
    for (const entry of bucket) {
      const match = nearest(entry.epoch, group.get(key) ?? []);
      if (!match || nearest(match.epoch, bucket) !== entry) continue;
      Object.assign(entry.battle, mergeBattleDetails(entry.battle, match.battle));
    }
  }
}

function mergeSameBattle(primary, other) {
  const previousIds = [...new Set([
    ...(primary.previousIds ?? []), other.id, ...(other.previousIds ?? []),
  ])].filter((id) => id !== primary.id);
  return {
    ...mergeBattleDetails(primary, other),
    playerName: primary.playerName || other.playerName,
    opponentName: primary.opponentName || other.opponentName,
    trophies: primary.trophies ?? other.trophies ?? null,
    ...(previousIds.length ? { previousIds } : {}),
  };
}

function mergeBattles(current, cached) {
  const live = new Map(current.map((battle) => [battle.id, battle]));
  const complete = new Map(live);
  for (const battle of cached) {
    const update = complete.get(battle.id);
    complete.set(battle.id, update ? mergeSameBattle(update, battle) : battle);
  }

  // The group API has returned the same creation time in both millisecond
  // precision and rounded to a whole second. Preserve the exact time and ID.
  const timed = [...complete.values()].map((battle) => ({ battle, epoch: Date.parse(battle.timestamp) }))
    .filter(({ epoch }) => Number.isFinite(epoch));
  const bySecond = Map.groupBy(timed, ({ battle, epoch }) => `${pairKey(battle)}|${Math.round(epoch / 1000)}`);
  for (const entries of bySecond.values()) {
    if (entries.length !== 2) continue;
    const whole = entries.find(({ epoch }) => epoch % 1000 === 0);
    const precise = entries.find(({ epoch }) => epoch % 1000 !== 0);
    if (!whole || !precise) continue;
    const firstCups = whole.battle.trophies;
    const secondCups = precise.battle.trophies;
    if (Number.isFinite(firstCups) && Number.isFinite(secondCups) && firstCups !== secondCups) continue;
    complete.set(precise.battle.id, mergeSameBattle(precise.battle, whole.battle));
    complete.delete(whole.battle.id);
  }

  const rows = [...complete.values()];
  const restored = rows.filter((battle) => {
    const liveCopies = [battle.id, ...(battle.previousIds ?? [])].map((id) => live.get(id)).filter(Boolean);
    return liveCopies.length === 0 || (battle.armyShareCode && !liveCopies.some((copy) => copy.armyShareCode));
  }).length;
  return { rows, restored };
}

async function mergeSnapshot(snapshotDir, league, current, currentDefenses) {
  if (!snapshotDir) return {
    attacks: mergeBattles(current, []).rows,
    defenses: mergeBattles(currentDefenses, []).rows,
    restoredAttacks: 0,
  };
  const path = resolve(snapshotDir, `${league.groupTag.slice(1)}-${league.seasonId}.json`);
  const previous = snapshotWrites.get(path) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    let cached = [];
    let cachedDefenses = [];
    try {
      const snapshot = JSON.parse(await readFile(path, 'utf8'));
      if (!Array.isArray(snapshot.attacks) || snapshot.groupTag !== league.groupTag
          || snapshot.seasonId !== league.seasonId) throw new Error('Invalid snapshot');
      cached = snapshot.attacks;
      if (Array.isArray(snapshot.defenses)) cachedDefenses = snapshot.defenses;
    } catch (error) {
      if (error.code !== 'ENOENT') throw clientError(500, '无法读取此小组的本地抓取记录。');
    }

    const { rows: attacks, restored: restoredAttacks } = mergeBattles(current, cached);
    const { rows: defenses } = mergeBattles(currentDefenses, cachedDefenses);
    const staging = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(staging, JSON.stringify({ ...league, attacks, defenses }), { encoding: 'utf8', mode: 0o600 });
      await rename(staging, path);
    } catch {
      throw clientError(500, '无法保存此小组的本地抓取记录。');
    } finally {
      await rm(staging, { force: true }).catch(() => {});
    }
    return { attacks, defenses, restoredAttacks };
  });
  snapshotWrites.set(path, pending);
  try {
    return await pending;
  } finally {
    if (snapshotWrites.get(path) === pending) snapshotWrites.delete(path);
  }
}

async function requestBattleLog(request, tag) {
  const result = await request(`${playerPath(tag)}/battlelog`);
  if (!Array.isArray(result.items)) throw clientError(502, '官方 API 未返回近期战斗日志。');
  return result.items;
}

function newestFirst(a, b) {
  return b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id);
}

function buildBattleViews(member, playerAttacks, playerDefenses, attackTelemetry, defenseTelemetry) {
  function rows(battles, isDefense) {
    return battles.sort(newestFirst).map((battle) => ({
      id: battle.id,
      ...(battle.previousIds?.length ? { previousIds: battle.previousIds } : {}),
      timestamp: battle.timestamp,
      battleTimestamp: battle.battleTimestamp ?? null,
      durationSeconds: battle.durationSeconds ?? null,
      opponentTag: isDefense ? battle.playerTag : battle.opponentTag,
      opponentName: (isDefense ? battle.playerName : battle.opponentName) ?? '',
      stars: battle.stars,
      destruction: battle.destruction,
      trophies: battle.trophies ?? null,
      trophyDelta: battle.trophies == null ? null
        : (isDefense && battle.battleType === 'LEGEND' ? -battle.trophies : battle.trophies),
      armyShareCode: battle.armyShareCode,
      armySource: battle.armySource ?? '',
      army: decodeArmyShareCode(battle.armyShareCode),
      ...(battle.battleType ? { battleType: battle.battleType } : {}),
    }));
  }
  const attacks = rows(playerAttacks, false);
  const defenses = rows(playerDefenses, true);
  return {
    playerTag: member.playerTag,
    playerName: member.playerName,
    attacks,
    defenses,
    telemetry: {
      attacks: { ...attackTelemetry, recorded: attacks.length, withArmy: attacks.filter((row) => row.armyShareCode).length },
      defenses: { ...defenseTelemetry, recorded: defenses.length, withArmy: defenses.filter((row) => row.armyShareCode).length },
    },
  };
}

async function fetchRecentPlayerReport(request, member, week, player) {
  const start = Date.parse(`${week}T05:00:00Z`);
  const logs = await requestBattleLog(request, member.playerTag);
  const ledger = { attacks: new Map(), defenses: new Map() };
  const malformed = { attacks: 0, defenses: 0 };

  for (const row of logs) {
    const mode = battleMode(row?.battleType);
    if (!row || (mode !== 'LEGEND' && mode !== 'RANKED')
        || (row.attack !== true && row.attack !== false)) continue;
    const key = row.attack ? 'attacks' : 'defenses';
    const epoch = timestamp(row.battleTimestamp);
    if (epoch < start || epoch >= start + 7 * day) continue;
    const battle = groupBattle({ ...row, creationTime: row.battleTimestamp }, member, !row.attack);
    if (!battle) {
      malformed[key] += 1;
      continue;
    }
    if (battle.armyShareCode) battle.armySource = row.attack ? 'attack' : 'defense';
    if (battle.trophies === null) {
      const gained = attackerTrophies(battle.stars, battle.destruction);
      battle.trophies = !row.attack && mode === 'RANKED' ? 40 - gained : gained;
    }
    const recorded = ledger[key].get(battle.id);
    const current = { ...battle, battleType: mode, battleTimestamp: battle.timestamp };
    ledger[key].set(battle.id, recorded ? mergeBattleDetails(current, recorded) : current);
  }

  const attackRows = [...ledger.attacks.values()];
  const defenseRows = [...ledger.defenses.values()];
  const battleViews = buildBattleViews(
    member,
    attackRows,
    defenseRows,
    { malformed: malformed.attacks, logFailures: 0 },
    { malformed: malformed.defenses, logFailures: 0 },
  );
  const attackSummary = summarizeStandingSide({ rows: attackRows, present: true, malformed: 0 }, null);
  const defenseSummary = summarizeStandingSide({ rows: defenseRows, present: true, malformed: 0 }, null);
  const defenseNet = battleViews.defenses.reduce((sum, battle) => sum + battle.trophyDelta, 0);
  const earned = defenseRows.some((battle) => battle.battleType === 'RANKED');
  const lost = defenseRows.some((battle) => battle.battleType === 'LEGEND');
  const defenseTrophyMode = earned && lost ? 'mixed' : earned ? 'earned' : 'lost';
  if (defenseTrophyMode === 'mixed') defenseSummary.trophies = null;

  const current = player.legendStatistics?.currentSeason;
  const currentLegendRank = nonnegativeInteger(current?.rank) || null;
  const currentLegendTrophies = nonnegativeInteger(current?.trophies) ?? nonnegativeInteger(player.trophies);
  const rank = week === weekMonday(Date.now() - rankedWeekStartOffset) ? currentLegendRank : null;
  const standing = buildStanding(member, rank, attackSummary, defenseSummary, attackSummary.trophies + defenseNet);
  return {
    groupTag: '',
    week,
    source: 'api',
    attacks: [],
    telemetry: { noWeeklyGroup: true },
    standings: [],
    battleViews: {
      ...battleViews,
      personalOnly: true,
      defenseTrophyMode,
      currentLegendRank,
      currentLegendTrophies,
      standing: { ...standing, defenseNetTrophies: defenseNet },
    },
  };
}

export async function fetchRankedReport({
  playerTag: rawTag, token: rawToken, week = '', groupTag: rawGroup = '',
  snapshotDir, fetchImpl = globalThis.fetch, requestIntervalMs = 100, includeBattleViews = false,
} = {}) {
  const playerTag = normalizeTag(rawTag);
  const requestedGroup = normalizeTag(rawGroup);
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!playerTag) throw clientError(400, '请输入有效的玩家标签，例如 #P0LYQ。');
  if (rawGroup && !requestedGroup) throw clientError(400, '请输入有效的排位小组标签。');
  if (!token || token.length > 4096 || /[^!-~]/.test(token)) {
    throw clientError(400, '请输入有效的 Clash of Clans API 令牌。');
  }
  if (week) {
    const epoch = Date.parse(`${week}T00:00:00Z`);
    if (typeof week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week)
      || !Number.isFinite(epoch) || weekMonday(epoch) !== week) {
      throw clientError(400, '周次请填写周一日期，例如 2026-11-23。');
    }
  }

  const request = apiRequest(token, fetchImpl, requestIntervalMs);
  const player = await request(playerPath(playerTag));
  const league = findLeagueGroup(player, week, requestedGroup);
  const noWeeklyGroup = !normalizeTag(player.currentLeagueGroupTag)
    && (['#0', '0'].includes(player.currentLeagueGroupTag) || player.leagueTier?.id === 105000036);
  if (includeBattleViews && !requestedGroup && noWeeklyGroup && (!week || !league)) {
    return fetchRecentPlayerReport(
      request, { playerTag, playerName: player.name ?? playerTag }, week || weekMonday(Date.now() - rankedWeekStartOffset), player,
    );
  }
  if (!league) throw clientError(404, '该玩家在所选周未返回排位小组。官方玩家资料仅提供当前及上一届小组。');
  const scoped = (tag) => request(groupBattlePath(league.groupTag, league.seasonId, tag));
  const group = await scoped(playerTag);
  if (!Array.isArray(group.members)) throw clientError(502, '官方 API 未返回小组成员名单。');

  const members = [...new Map(group.members.flatMap((member, index) => {
    const tag = normalizeTag(member?.playerTag);
    // The official member list is already sorted, including its own tiebreaks.
    return tag ? [[tag, { ...member, playerTag: tag, rank: index + 1 }]] : [];
  })).values()];
  const groupResults = await inBatches(members, (member) =>
    member.playerTag === playerTag ? group : scoped(member.playerTag));

  const groupLedgers = new Map();
  let malformedAttacks = 0;
  let groupLogFailures = 0;
  for (const [index, { value, status }] of groupResults.entries()) {
    const member = members[index];
    if (status || (!Array.isArray(value?.attackLogs) && memberAttackCount(member) > 0)) {
      groupLogFailures += 1;
    }
    const attacks = readGroupBattles(value?.attackLogs, member);
    const defenses = readGroupBattles(value?.defenseLogs, member, true);
    groupLedgers.set(member.playerTag, { attacks, defenses });
    malformedAttacks += attacks.malformed;
  }

  const selectedMember = members.find((member) => member.playerTag === playerTag)
    ?? { playerTag, playerName: player.name ?? playerTag };
  const selectedLedger = groupLedgers.get(playerTag);
  const selectedAttackLog = includeBattleViews
    ? selectedLedger?.attacks ?? readGroupBattles(group.attackLogs, selectedMember)
    : null;
  const selectedDefenseLog = includeBattleViews
    ? selectedLedger?.defenses ?? readGroupBattles(group.defenseLogs, selectedMember, true)
    : null;
  const current = [...groupLedgers.values()].flatMap(({ attacks }) => attacks.rows);
  const groupDefenses = [...groupLedgers.values()].flatMap(({ defenses }) => defenses.rows);
  const currentDefenses = selectedDefenseLog && !selectedLedger
    ? [...groupDefenses, ...selectedDefenseLog.rows]
    : groupDefenses;

  // Match both sides of group attacks and of the selected player's defenses.
  // For other members' defense timing, use their own recent logs and logs
  // already fetched for attacks, without requesting every outside attacker.
  const participantTags = (entries) => entries.filter((battle) =>
    !battle.armyShareCode || battle.durationSeconds == null)
    .flatMap((battle) => [battle.playerTag, battle.opponentTag]);
  const defenseMemberTags = groupDefenses.filter((battle) => battle.durationSeconds == null)
    .map((battle) => battle.opponentTag);
  const groupParticipants = new Set([...participantTags(current), ...defenseMemberTags]);
  const attackParticipants = new Set(participantTags(selectedAttackLog?.rows ?? []));
  const defenseParticipants = new Set(participantTags(selectedDefenseLog?.rows ?? []));
  const participants = [...new Set([...groupParticipants, ...attackParticipants, ...defenseParticipants])];
  const logs = await inBatches(participants, (tag) => requestBattleLog(request, tag));
  const views = { attack: new Map(), defense: new Map() };
  for (const [index, result] of logs.entries()) {
    if (result.value) indexBattleViews(result.value, participants[index], views);
  }
  joinBattleDetails(current, views);
  reuseGroupBattleDetails(currentDefenses, current);
  joinBattleDetails(currentDefenses, views);
  const { attacks: merged, defenses, restoredAttacks } = await mergeSnapshot(snapshotDir, league, current, currentDefenses);
  const attacksByMember = groupByOwner(merged, 'playerTag');
  const defensesByMember = groupByOwner(defenses, 'opponentTag');
  const standings = members.map((member) => {
    const ledger = groupLedgers.get(member.playerTag);
    const attacks = attacksByMember.get(member.playerTag) ?? [];
    const knownDefenses = defensesByMember.get(member.playerTag) ?? [];
    return groupStanding(
      member,
      { ...ledger.attacks, rows: attacks, present: ledger.attacks.present || !!attacks.length },
      { ...ledger.defenses, rows: knownDefenses, present: ledger.defenses.present || !!knownDefenses.length },
    );
  });
  const attacks = merged.sort(newestFirst)
    .map((attack) => ({ ...attack, army: decodeArmyShareCode(attack.armyShareCode) }));

  const failedParticipants = participants.filter((_, index) => logs[index].status);
  const battleLogFailures = failedParticipants.filter((tag) => groupParticipants.has(tag)).length;
  const listedAttacks = members.reduce((total, member) => total + (memberAttackCount(member) ?? 0), 0);
  const missingArmy = attacks.filter((attack) => !attack.army?.troops.length).length;
  let battleViews;
  if (includeBattleViews) {
    const selectedAttacks = selectedAttackLog.rows;
    reuseGroupBattleDetails(selectedAttacks, merged);
    joinBattleDetails(selectedAttacks, views);
    const playerAttacks = mergeBattles(selectedAttacks, attacksByMember.get(playerTag) ?? []).rows;
    const playerDefenses = defensesByMember.get(playerTag) ?? [];
    reuseGroupBattleDetails(playerDefenses, merged);
    battleViews = buildBattleViews(
      selectedMember, playerAttacks, playerDefenses,
      {
        malformed: selectedAttackLog.malformed,
        logFailures: failedParticipants.filter((tag) => attackParticipants.has(tag)).length
          + Number(!Array.isArray(group.attackLogs) && memberAttackCount(selectedMember) > 0),
      },
      {
        malformed: selectedDefenseLog.malformed,
        logFailures: failedParticipants.filter((tag) => defenseParticipants.has(tag)).length
          + Number(!Array.isArray(group.defenseLogs) && memberDefenseCount(selectedMember) > 0),
      },
    );
    battleViews.defenseTrophyMode = 'earned';
    battleViews.standing = standings.find((standing) => standing.playerTag === playerTag)
      ?? groupStanding(selectedMember, selectedAttackLog, selectedDefenseLog);
  }
  return {
    ...league,
    source: 'api',
    attacks,
    standings,
    telemetry: {
      members: members.length,
      expectedAttacks: Math.max(listedAttacks, attacks.length),
      collectedAttacks: attacks.length,
      missingArmy,
      recoveredFromDefense: attacks.filter((attack) => attack.armySource === 'defense' && attack.army?.troops.length).length,
      restoredAttacks,
      groupLogFailures,
      battleLogFailures,
      malformedAttacks,
    },
    ...(battleViews ? { battleViews } : {}),
  };
}
