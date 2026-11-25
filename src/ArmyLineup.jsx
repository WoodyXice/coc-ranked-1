import { useState } from "react";
import catalog from "./army-icons.json";
import "./army-lineup.css";

const groups = [
  { key: "troops", type: "troops", label: "部队" },
  { key: "spells", type: "spells", label: "法术" },
  { key: "siegeMachines", type: "siegeMachines", label: "攻城机器" },
  { key: "clanCastleTroops", alternate: "reinforcements", type: "troops", label: "部落城堡援军" },
  { key: "clanCastleSpells", alternate: "reinforcementSpells", type: "spells", label: "部落城堡法术" },
  { key: "clanCastleSiegeMachines", type: "siegeMachines", label: "部落城堡攻城机器" },
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

function ArmyGroup({ units, type, label }) {
  if (units.length === 0) return null;
  return (
    <span className="lineup-group" role="group" aria-label={label}>
      {units.map((unit, index) => <UnitTile key={`${unitKey(unit)}:${index}`} unit={unit} type={type} category={label} />)}
    </span>
  );
}

export function ArmyAttribution() {
  return <p className="lineup-attribution">图标来源 ClashKing Assets · 游戏素材归 Supercell 所有。本作品为非官方粉丝作品，未获 Supercell 认可。</p>;
}

export default function ArmyLineup({ army, label = "阵容", showAttribution = false }) {
  if (!hasLineup(army)) return null;
  const heroes = armyUnits(army, "heroes");
  const heroGear = new Set(heroes.flatMap((hero) => armyUnits(hero, "equipment").map(unitKey)));
  const extraGear = armyUnits(army, "equipment").filter((unit) => !heroGear.has(unitKey(unit)));

  return (
    <div className="lineup-block">
      <div className="lineup-strip" role="group" aria-label={label} tabIndex={0}>
        {groups.map(({ key, alternate, type, label: title }) => (
          <ArmyGroup key={key} units={armyUnits(army, key, alternate)} type={type} label={title} />
        ))}
        {heroes.length > 0 && (
          <span className="lineup-group" role="group" aria-label="英雄、战宠与装备">
            {heroes.map((hero, index) => (
              <span className="lineup-hero" key={`${unitKey(hero)}:${index}`} role="group" aria-label={unitName(hero, "heroes")}>
                <UnitTile unit={hero} type="heroes" category="英雄" />
                {hero.pet && <UnitTile unit={hero.pet} type="pets" category={`${unitName(hero, "heroes")}的战宠`} />}
                {armyUnits(hero, "equipment").map((unit, gearIndex) => (
                  <UnitTile key={`${unitKey(unit)}:${gearIndex}`} unit={unit} type="equipment" category={`${unitName(hero, "heroes")}的装备`} />
                ))}
              </span>
            ))}
          </span>
        )}
        <ArmyGroup units={extraGear} type="equipment" label="英雄装备" />
      </div>
      {showAttribution && <ArmyAttribution />}
    </div>
  );
}
