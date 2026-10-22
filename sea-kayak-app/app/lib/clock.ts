const singaporeClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
})

export function getSgtHour(date = new Date()): number {
  const parts = singaporeClock.formatToParts(date)
  return Number(parts.find(part => part.type === "hour")?.value) + Number(parts.find(part => part.type === "minute")?.value) / 60
}
