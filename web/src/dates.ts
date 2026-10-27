export function today(timezone = "Asia/Seoul") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function currentTime(timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date());
}

export function dateRange(date: string, period: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (period === "year") return [`${year}-01-01`, `${year}-12-31`];
  if (period === "day") return [date, date];
  if (period === "week") {
    const d = new Date(year, month - 1, day, 12);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const format = (v: Date) =>
      `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    const start = format(d);
    d.setDate(d.getDate() + 6);
    return [start, format(d)];
  }
  return [
    `${year}-${String(month).padStart(2, "0")}-01`,
    `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`,
  ];
}
