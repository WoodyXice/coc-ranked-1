import { useId, useLayoutEffect, useRef, useState } from "react";
import catalog from "./army-icons.json";
import "./army-lineup.css";

const groups = [
  { key: "troops", type: "troops", label: "部队" },
  { key: "spells", type: "spells", label: "法术" },
  { key: "siegeMachines", type: "siegeMachines", label: "攻城机器" },
  { key: "clanCastleTroops", alternate: "reinforcements", type: "troops", label: "部落城堡", kind: "援军" },
  { key: "clanCastleSpells", alternate: "reinforcementSpells", type: "spells", label: "部落城堡", kind: "法术" },
  { key: "clanCastleSiegeMachines", type: "siegeMachines", label: "部落城堡", kind: "攻城机器" },
  { key: "pets", type: "pets", label: "战宠" },
];

function armyUnits(army, key, alternate) {
  const primary = army?.[key];
  const units = Array.isArray(primary) && primary.length ? primary : army?.[alternate];
  return Array.isArray(units) ? units.filter(Boolean) : [];
}

export function hasLineup(army) {
  return armyUnits(army, "heroes").length > 0 || armyUnits(army, "equipment").length > 0
    || groups.some(({ key, alternate }) => armyUnits(army, key, alternate).length > 0);
}

function unitName(unit, type) {
  return unit.displayName || catalog.entries[`${type}:${unit.id}`]?.name || unit.name || "未知单位";
}

function unitKey(unit) {
  return String(unit.id ?? unit.name ?? unit.displayName);
}

function monogram(name) {
  if (/\p{Script=Han}/u.test(name)) return [...name].slice(0, 2).join("");
  const initials = name.match(/[A-Za-z0-9]+/g) ?? [];
  return initials.length > 1 ? initials.slice(0, 3).map((part) => part[0]).join("").toUpperCase()
    : (initials[0] || "?").slice(0, 2).toUpperCase();
}

function unitIcon(unit, type) {
  const localFile = catalog.entries[`${type}:${unit.id}`]?.file;
  if (typeof localFile === "string" && /^[A-Za-z0-9_-]+\.(?:webp|png|jpg)$/i.test(localFile)) return `./army-icons/${localFile}`;
  const path = typeof unit.icon === "string" ? unit.icon.replace(/^\.\//, "") : "";
  if (path.includes("..") || !/^army-icons\/[A-Za-z0-9/_-]+\.(?:webp|png|jpg)$/i.test(path)) return "";
  return `./${path}`;
}

function UnitTile({ unit, type, category }) {
  const [failed, setFailed] = useState("");
  const name = unitName(unit, type);
  const quantity = Number.isFinite(unit.count) ? `×${unit.count}` : "";
  const icon = unitIcon(unit, type);
  const details = [name, quantity].filter(Boolean).join(" ");
  const title = category ? `${category} · ${details}` : details;

  return (
    <span className="lineup-unit" data-unit-type={type} title={title} role="img" aria-label={title}>
      {icon && failed !== icon ? <img src={icon} alt="" loading="lazy" onError={() => setFailed(icon)} />
        : <span aria-hidden="true">{monogram(name)}</span>}
      {quantity && <span className="lineup-unit-count" aria-hidden="true">{quantity}</span>}
    </span>
  );
}

function lineupSections(army) {
  const sections = [];
  for (const { key, alternate, type, label, kind } of groups) {
    const units = armyUnits(army, key, alternate);
    if (!units.length) continue;
    const entries = units.map(unit => ({ unit, type, kind }));
    if (sections.at(-1)?.label === label) sections.at(-1).entries.push(...entries);
    else sections.push({ label, entries });
  }
  const equipped = new Set();
  for (const hero of armyUnits(army, "heroes")) {
    const entries = [{ unit: hero, type: "heroes" }];
    if (hero.pet) entries.push({ unit: hero.pet, type: "pets", kind: "战宠" });
    for (const unit of armyUnits(hero, "equipment")) {
      entries.push({ unit, type: "equipment", kind: "装备" });
      equipped.add(unitKey(unit));
    }
    sections.push({ label: `英雄 · ${unitName(hero, "heroes")}`, hero: true, entries });
  }
  const gear = armyUnits(army, "equipment").filter(unit => !equipped.has(unitKey(unit)));
  if (gear.length) sections.push({ label: "英雄装备", entries: gear.map(unit => ({ unit, type: "equipment" })) });
  return sections;
}

function DetailUnits({ section }) {
  return <ul className={section.hero ? "lineup-detail-team" : "lineup-detail-units"} aria-label={section.label}>
    {section.entries.map(({ unit, type, kind }, index) => <li key={index}>
      <UnitTile unit={unit} type={type} category={kind ? `${section.label} · ${kind}` : section.label} />
      <span className="lineup-detail-name">{unitName(unit, type)}</span>
    </li>)}
  </ul>;
}

function LineupDetail({ sections, label, onDismiss, trigger }) {
  const heading = useId();
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const panel = dialog.current;
    const opener = trigger.current;
    panel.showModal();
    return () => {
      panel.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [trigger]);
  const teams = sections.filter(section => section.hero);
  // Clicks on the backdrop target the dialog itself, outside its box. Require the press
  // to start there too, so a text selection that ends outside does not close it.
  const pressedOutside = useRef(false);
  const outside = event => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  return <dialog ref={dialog} className="lineup-detail" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onDismiss(); }}
    onPointerDown={event => { pressedOutside.current = outside(event); }}
    onClick={event => {
      event.stopPropagation();
      if (pressedOutside.current && outside(event)) onDismiss();
      pressedOutside.current = false;
    }}>
    <header className="lineup-detail-heading">
      <h3 id={heading}>{label}</h3>
      <button type="button" aria-label="关闭阵容详情" onClick={onDismiss}>关闭</button>
    </header>
    <div className="lineup-detail-body">
      {sections.filter(section => !section.hero).map(section => <section key={section.label} className="lineup-detail-section">
        <h4>{section.label}</h4><DetailUnits section={section} />
      </section>)}
      {teams.length > 0 && <section className="lineup-detail-section lineup-detail-heroes">
        <h4>英雄配装</h4>
        <div className="lineup-detail-teams">{teams.map((team, index) => <DetailUnits key={index} section={team} />)}</div>
      </section>}
    </div>
  </dialog>;
}

export function ArmyAttribution() {
  return <p className="lineup-attribution">图标来源 ClashKing Assets · 游戏素材归 Supercell 所有。本作品为非官方粉丝作品，未获 Supercell 认可。</p>;
}

export default function ArmyLineup({ army, label = "阵容", showAttribution = false }) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef(null);
  const sections = lineupSections(army);
  if (!sections.length) return null;

  return (
    <div className="lineup-block">
      <button type="button" ref={trigger} className="lineup-strip" aria-haspopup="dialog"
        aria-label={`放大查看${label}`} title={`放大查看${label}`} onClick={() => setExpanded(true)}>
        {sections.map(({ label: section, entries }, groupIndex) =>
          <span key={groupIndex} className="lineup-group">
            {entries.map(({ unit, type, kind }, index) =>
              <UnitTile key={index} unit={unit} type={type} category={kind ? `${section} · ${kind}` : section} />)}
          </span>
        )}
      </button>
      {expanded && <LineupDetail sections={sections} label={label} trigger={trigger} onDismiss={() => setExpanded(false)} />}
      {showAttribution && <ArmyAttribution />}
    </div>
  );
}
