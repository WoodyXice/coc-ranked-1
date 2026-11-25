const battleDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(+date) ? "—" : battleDate.format(date);
}

export function formatShortTime(value) {
  const time = formatTime(value);
  return time === "—" ? time : time.slice(5, 16);
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
