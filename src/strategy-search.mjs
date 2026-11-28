const styleHues = { 龙流: 203, 天女蓝胖: 268, 气球冰狗: 165, 火球拆阵: 13, 巨矛投手: 34, 超级大雪怪: 329 };
const aliases = { 天女蓝胖: ["超级蓝胖", "超蓝"], 雷龙流: ["电龙"], 气球冰狗: ["冰狗球"] };

export function styleColors(name) {
  let hash = 0;
  for (const char of name) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
  const hue = styleHues[name] ?? hash % 360;
  return { color: `hsl(${hue} 52% 73%)`, pointColor: `hsl(${hue} 56% 37%)` };
}

export function matchesStyleName(name, query) {
  const compact = value => value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
  const term = [...compact(query)];
  return [name, ...(aliases[name] ?? [])].some(value => {
    let position = 0;
    for (const char of compact(value)) if (char === term[position]) position++;
    return position === term.length;
  });
}
