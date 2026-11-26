import { decodeArmyShareCode } from './collector.mjs';

const CATEGORIES = [
  { name: '蓝胖', color: '#3987e5' },
  { name: '巨矛投手', color: '#d95926' },
  { name: '龙流', color: '#199e70' },
  { name: '超级大雪怪', color: '#c98500' },
  { name: '火球拆阵', color: '#d55181' },
  { name: '气球冰狗', color: '#0ca30c' },
  { name: '其他', color: '#6f7177' },
];

const BOWLER_VARIANTS = ['其他蓝胖', '天女蓝胖', '隐龙蓝胖'];
const OTHER_VARIANTS = ['其他', '皮卡泰坦', '纯气球', '废墟女巫'];

function lookupKey(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s_\-]/g, '');
}

function makeAliases(values) {
  return new Map(values.flatMap(([name, ...aliases]) => [name, ...aliases].map(alias => [lookupKey(alias), name])));
}

const STRATEGIES = makeAliases([
  ['蓝胖', 'bowler', 'bowlers', 'super bowler', 'super bowlers', '蓝胖流', '超级蓝胖', '超级投石手', '巨石投手', '超级巨石投手', '超級巨石投手'],
  ['其他蓝胖', 'other bowler'],
  ['天女蓝胖', '天女', 'queen charge bowler', 'queen walk bowler', 'qc bowler'],
  ['隐龙蓝胖', '隐龙', 'invis dragon bowler', 'invisible dragon bowler', 'invisible bowler'],
  ['巨矛投手', '投矛手', '投手', 'thrower', 'throwers', 'longshot'],
  ['龙流', 'dragons', 'dragon', 'dragon attacks', '龙', '龙流派'],
  ['超级大雪怪', '超级雪怪', '超雪', 'super yeti', 'super yetis'],
  ['火球拆阵', '火球', 'fireball', 'fireball entry'],
  ['气球冰狗', '冰狗球', 'ice hound balloons', 'ice hound lalo', 'ice lalo'],
  ['其他', 'other', 'others', 'unknown', '未分类'],
  ['皮卡泰坦', 'pekka titan', 'pekka electro titan'],
  ['纯气球', 'mass balloons', 'mass balloon'],
  ['废墟女巫', 'ruin witch', 'ruin witches'],
]);

const UNITS = makeAliases([
  ['Bowler', '投石手', '巨石投手', '蓝胖'],
  ['Super Bowler', '超级投石手', '超级巨石投手', '超級巨石投手', '超级蓝胖', '超蓝', '超蓝胖'],
  ['Healer', '天使', 'healers'],
  ['Thrower', '巨矛投手', '投矛手', '投手', 'throwers', 'longshot'],
  ['Dragon', '飞龙', '龙', 'dragons'],
  ['Electro Dragon', '雷电飞龙', '雷龙', 'electro dragons'],
  ['Super Dragon', '超级飞龙', '超龙', 'super dragons'],
  ['Dragon Rider', '龙骑士', '龙骑', 'dragon riders'],
  ['Inferno Dragon', '地狱飞龙', '地狱龙', 'inferno dragons'],
  ['Baby Dragon', '飞龙宝宝', '龙宝'],
  ['Super Yeti', '超级大雪怪', '超级雪怪', '超雪', 'super yetis'],
  ['Ice Hound', '寒冰猎犬', '冰霜猎犬', '冰狗', 'ice hounds'],
  ['Balloon', '气球兵', '气球', 'balloons'],
  ['P.E.K.K.A', 'pekka', '皮卡', '皮卡超人'],
  ['Electro Titan', '雷电泰坦', '雷霆泰坦', '电泰坦', '泰坦'],
  ['Ruin Witch', '废墟女巫', 'ruin witches'],
  ['Invisibility Spell', '隐形法术', '隐身法术', '隐形', '隐身', 'invisibility'],
  ['Fireball', '火球', '火球装备'],
  ['Archer Queen', '弓箭女皇', '女皇', 'queen'],
  ['Balloon Squad', '气球兵小队', '氣球兵小隊'],
  ['Healer Squad', '天使小队', '天使小隊'],
  ['P.E.K.K.A Titan Squad', 'PEKKA Titan Squad', '皮卡泰坦小队', '皮卡泰坦小隊'],
  ['Dragon Squad', 'Dragons Squad', '飞龙小队', '飛龍小隊'],
]);

// Supercell's November 2026 Clash of Titans release notes define these compositions.
const SQUADS = new Map([
  ['Balloon Squad', [['Balloon', 4]]],
  ['Healer Squad', [['Healer', 5], ['Balloon', 1]]],
  ['P.E.K.K.A Titan Squad', [['P.E.K.K.A', 1], ['Electro Titan', 1]]],
  ['Dragon Squad', [['Dragon', 2], ['Dragon Rider', 2]]],
]);

const dateInShanghai = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const countFormatter = new Intl.NumberFormat('zh-CN');

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTag(value) {
  const tag = asText(value).toUpperCase().replace(/^#/, '');
  return /^[A-Z0-9]+$/.test(tag) ? `#${tag}` : '';
}

function getWeek(value) {
  const week = asText(value);
  if (!week) return { start: '', end: '' };
  const start = new Date(`${week}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(+start)
    || start.toISOString().slice(0, 10) !== week || start.getUTCDay() !== 1) {
    throw new Error('周起始日应使用 YYYY-MM-DD 格式的周一日期。');
  }
  const end = new Date(+start + 7 * 86_400_000).toISOString().slice(0, 10);
  return { start: week, end };
}

function normalizeTime(value) {
  const raw = asText(value);
  if (!raw && typeof value !== 'number') return '';
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(raw);
  const timestamp = compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}${compact[7] ?? ''}Z` : raw;
  const date = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp)
    ? new Date(`${timestamp.replace(' ', 'T')}+08:00`)
    : new Date(typeof value === 'number' ? value : timestamp);
  return Number.isNaN(+date) ? '' : date.toISOString();
}

function getStrategy(name) {
  const label = asText(name);
  return STRATEGIES.get(lookupKey(label)) ?? label;
}

function getCategory(name) {
  if (BOWLER_VARIANTS.includes(name)) return '蓝胖';
  return CATEGORIES.some(category => category.name === name) ? name : '其他';
}

function normalizeUnits(value) {
  let units = value;
  if (units && !Array.isArray(units) && typeof units === 'object') {
    units = Object.entries(units).map(([name, count]) => ({ name, count }));
  }
  if (!Array.isArray(units)) return [];
  const counts = new Map();
  for (const entry of units) {
    const name = asText(typeof entry === 'string' ? entry : entry?.name ?? entry?.unit);
    const count = typeof entry === 'string' ? 1 : entry?.count ?? entry?.quantity ?? entry?.amount ?? 1;
    if (!name || !Number.isSafeInteger(count) || count <= 0) continue;
    const unit = UNITS.get(lookupKey(name)) ?? name;
    counts.set(unit, (counts.get(unit) ?? 0) + count);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

function parseShareCode(code) {
  if (!code) return null;
  try {
    return decodeArmyShareCode(code);
  } catch {
    return null;
  }
}

function normalizeArmy(attack, code) {
  const supplied = attack.army ?? attack.lineup;
  const army = supplied && typeof supplied === 'object' ? supplied : parseShareCode(code);
  const payloadTroops = Array.isArray(army) ? army : army?.troops ?? army?.units;
  const heroes = army?.heroes ?? attack.heroes;
  const equipment = normalizeUnits(army?.equipment ?? army?.heroEquipment ?? attack.equipment ?? attack.heroEquipment);
  const equipped = Array.isArray(heroes)
    ? heroes.flatMap(hero => normalizeUnits(hero?.equipment))
    : [];
  return {
    troops: normalizeUnits(payloadTroops ?? attack.troops ?? attack.units),
    spells: normalizeUnits(army?.spells ?? attack.spells),
    heroes: normalizeUnits(heroes),
    equipment: normalizeUnits([...equipment, ...equipped]),
    siegeMachines: normalizeUnits(army?.siegeMachines ?? attack.siegeMachines),
  };
}

function classify(army) {
  const counts = new Map();
  for (const { name, count } of army.troops) {
    for (const [unit, perSquad] of SQUADS.get(name) ?? [[name, 1]]) {
      counts.set(unit, (counts.get(unit) ?? 0) + count * perSquad);
    }
  }
  const troop = name => counts.get(name) ?? 0;
  const invisibility = army.spells.find(unit => unit.name === 'Invisibility Spell')?.count ?? 0;
  const dragons = troop('Dragon') + troop('Electro Dragon') + troop('Super Dragon') + troop('Dragon Rider') + troop('Inferno Dragon');

  const hasHero = name => army.heroes.some(unit => unit.name === name);
  const hasGear = name => army.equipment.some(unit => unit.name === name);
  if (troop('Super Bowler') >= 3 || troop('Bowler') >= 8) {
    if (hasHero('Archer Queen') && hasGear('Monolith Arrow')) return '天女蓝胖';
    if (hasHero('Dragon Duke') && hasGear('Electro Fangs') && invisibility >= 3) return '隐龙蓝胖';
    return '其他蓝胖';
  }
  if (troop('Super Yeti') >= 3) return '超级大雪怪';
  if (troop('Thrower') >= 5) return '巨矛投手';
  if (troop('Ice Hound') > 0 && troop('Balloon') >= 10) return '气球冰狗';
  if (dragons >= 5) return '龙流';
  if (army.equipment.some(unit => unit.name === 'Fireball') && invisibility >= 2) return '火球拆阵';
  if (troop('P.E.K.K.A') >= 2 && troop('Electro Titan') >= 2) return '皮卡泰坦';
  if (troop('Balloon') >= 20 && dragons === 0) return '纯气球';
  if (troop('Ruin Witch') >= 3) return '废墟女巫';
  return '其他';
}

const RANKED_MODES = new Set(['ranked', 'rankedbattle', 'rankedbattles', 'rankedattack', 'rankedattacks', 'rankedleague', 'league', '排位', '排位进攻', '排位赛', '传奇排位']);

function scoreValue(value, max) {
  if (value == null || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= max ? score : null;
}

function normalizeAttack(entry, window, source) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const mode = lookupKey(entry.mode ?? entry.battleType);
  const direction = lookupKey(entry.direction);
  if ((mode && !RANKED_MODES.has(mode)) || entry.attack === false
    || ['defense', 'defence', '防守'].includes(direction)) return null;
  const rawTime = entry.timestamp ?? entry.time ?? entry.date;
  const timestamp = normalizeTime(rawTime);
  if (rawTime != null && rawTime !== '' && !timestamp) return null;
  const day = timestamp ? dateInShanghai.format(new Date(timestamp)) : '';
  if (source !== 'api' && window.start && day && (day < window.start || day >= window.end)) return null;
  const armyShareCode = asText(entry.armyShareCode ?? entry.armyCode ?? entry.army ?? entry.lineup);
  const army = normalizeArmy(entry, armyShareCode);
  const supplied = getStrategy(entry.strategy ?? entry.archetype ?? entry.category ?? entry.name);
  if (!supplied && !army.troops.length) return null;

  const strategy = supplied || classify(army);
  const duration = entry.durationSeconds ?? entry.battleTime;
  return {
    id: typeof entry.id === 'number' ? String(entry.id) : asText(entry.id ?? entry.attackId),
    playerTag: formatTag(entry.playerTag ?? entry.attackerTag ?? entry.attacker?.tag),
    playerName: asText(entry.playerName ?? entry.attacker?.name),
    opponentTag: formatTag(entry.opponentTag ?? entry.defenderTag ?? entry.defender?.tag),
    timestamp,
    durationSeconds: Number.isSafeInteger(duration) && duration >= 0 ? duration : null,
    armyShareCode,
    armySource: asText(entry.armySource),
    stars: scoreValue(entry.stars, 3),
    destruction: scoreValue(entry.destruction ?? entry.destructionPercentage, 100),
    name: strategy,
    strategy,
    category: getCategory(strategy),
    classification: supplied ? 'provided' : 'heuristic',
    army,
  };
}

export const sampleData = {
  groupTag: '#DEMO',
  week: '2026-11-23',
  source: 'sample',
  counts: [
    { name: '其他蓝胖', count: 107 },
    { name: '天女蓝胖', count: 84 },
    { name: '隐龙蓝胖', count: 32 },
    { name: '巨矛投手', count: 150 },
    { name: '龙流', count: 99 },
    { name: '超级大雪怪', count: 94 },
    { name: '火球拆阵', count: 50 },
    { name: '气球冰狗', count: 30 },
    { name: '其他', count: 25 },
    { name: '皮卡泰坦', count: 9 },
    { name: '纯气球', count: 2 },
    { name: '废墟女巫', count: 1 },
  ],
};

export const importTemplates = {
  counts: { groupTag: sampleData.groupTag, week: '2026-11-23', counts: sampleData.counts },
  attacks: {
    groupTag: sampleData.groupTag,
    week: '2026-11-23',
    attacks: [
      { id: 'demo-1', playerTag: '#DEMO1', opponentTag: '#DEMO2', timestamp: '2026-11-23T12:00:00+08:00', strategy: '天女蓝胖', stars: 3, destruction: 100 },
      { id: 'demo-2', playerTag: '#DEMO2', opponentTag: '#DEMO1', timestamp: '2026-11-23T12:08:00+08:00', army: { troops: [{ name: 'Thrower', count: 9 }] }, stars: 2, destruction: 74 },
    ],
  },
};

function detailOrder(category, [name]) {
  const order = (category === '蓝胖' ? BOWLER_VARIANTS : OTHER_VARIANTS).indexOf(name);
  return order === -1 ? Infinity : order;
}

export function getReport(input) {
  if (!input || typeof input !== 'object' || !(Array.isArray(input.counts) || Array.isArray(input.attacks))) {
    throw new Error('需要包含 counts 或 attacks 数组的 JSON 对象。');
  }
  if (Array.isArray(input.counts) && Array.isArray(input.attacks)) {
    throw new Error('请在同一个文件中提供 counts 或 attacks 其中一种数据。');
  }
  const rawTag = input.groupTag ?? input.tag;
  const groupTag = formatTag(rawTag);
  if (rawTag && !groupTag) throw new Error('请输入有效的小组标签。');
  const window = getWeek(input.week);
  const source = asText(input.source) || 'import';
  const grouped = new Map(CATEGORIES.map(({ name }) => [name, new Map()]));
  const performance = new Map();
  let total = 0;
  function add(name, count) {
    if (count === 0) return;
    const details = grouped.get(getCategory(name));
    details.set(name, (details.get(name) ?? 0) + count);
    total += count;
    if (!Number.isSafeInteger(total)) throw new Error('进攻场数过大。');
  }

  let skipped = 0;
  let duplicates = 0;
  let heuristic = 0;
  const attacks = [];
  if (Array.isArray(input.counts)) {
    for (const item of input.counts) {
      const name = getStrategy(item?.name ?? item?.strategy);
      if (!name || !Number.isSafeInteger(item?.count) || item.count < 0) {
        throw new Error('每条汇总记录都需要流派名称和非负整数场数。');
      }
      add(name, item.count);
    }
  } else {
    const seen = new Set();
    for (const entry of input.attacks) {
      const attack = normalizeAttack(entry, window, source);
      if (!attack) {
        skipped += 1;
        continue;
      }
      const { id, playerTag, opponentTag, timestamp } = attack;
      const keys = [];
      if (id) keys.push(JSON.stringify(['id', playerTag, id]));
      if (playerTag && opponentTag && timestamp) keys.push(JSON.stringify(['attack', playerTag, opponentTag, timestamp]));
      if (keys.some(key => seen.has(key))) {
        duplicates += 1;
        continue;
      }
      for (const key of keys) seen.add(key);
      if (attack.classification === 'heuristic') heuristic += 1;
      attacks.push(attack);
      add(attack.strategy, 1);
      const stats = performance.get(attack.category)
        ?? { scoredCount: 0, threeStarCount: 0, stars: 0, destruction: 0, destructionCount: 0 };
      if (Number.isInteger(attack.stars)) {
        stats.scoredCount += 1;
        stats.threeStarCount += Number(attack.stars === 3);
        stats.stars += attack.stars;
      }
      if (Number.isFinite(attack.destruction)) {
        stats.destructionCount += 1;
        stats.destruction += attack.destruction;
      }
      performance.set(attack.category, stats);
    }
  }

  const rows = CATEGORIES.map(({ name, color }) => {
    const entries = [...grouped.get(name)].sort((a, b) => detailOrder(name, a) - detailOrder(name, b) || b[1] - a[1]);
    const count = entries.reduce((sum, [, value]) => sum + value, 0);
    const details = entries.filter(([value]) => value !== name).map(([name, count]) => ({ name, count }));
    const stats = performance.get(name);
    return {
      name, count, color, share: total ? count / total : 0, details,
      scoredCount: stats?.scoredCount ?? 0,
      threeStarCount: stats?.threeStarCount ?? 0,
      threeStarRate: stats?.scoredCount ? stats.threeStarCount / stats.scoredCount : null,
      averageStars: stats?.scoredCount ? stats.stars / stats.scoredCount : null,
      averageDestruction: stats?.destructionCount ? stats.destruction / stats.destructionCount : null,
    };
  }).filter(row => row.count > 0).sort((left, right) => right.share - left.share);

  const notes = [];
  const breakdown = entries => [...entries].map(([name, count]) => `${name} ${countFormatter.format(count)}`);
  const other = grouped.get('其他');
  if (other.size > 1 || (other.size === 1 && !other.has('其他'))) notes.push(`「其他」= ${breakdown(other).join(' + ')}。`);
  const bowlers = grouped.get('蓝胖');
  if (bowlers.size > 1 || (bowlers.size === 1 && !bowlers.has('蓝胖'))) notes.push(`蓝胖细分：${breakdown(bowlers).join('、')}。`);
  if (heuristic) notes.push(`${countFormatter.format(heuristic)} 场按阵容特征归类，实际打法可能不同。`);
  if (skipped) notes.push(`${countFormatter.format(skipped)} 场因没有可识别的阵容或超出统计范围而排除。`);
  if (duplicates) notes.push(`已去重 ${countFormatter.format(duplicates)} 场。`);

  return { groupTag, week: window.start, source, total, skipped, duplicates, heuristic, rows, notes, attacks, telemetry: input.telemetry ?? null };
}
