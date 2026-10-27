// 日期工具：杂志目录按「本机时区的自然日」分页。日期键写成 2026-10-19。
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const p2 = (n: number) => String(n).padStart(2, '0')

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export function parseDay(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

// 这一天的起止（秒）：[当天 0 点, 次日 0 点)
export function dayRange(key: string): [number, number] {
  const start = parseDay(key)!
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
  return [Math.floor(start.getTime() / 1000), Math.floor(end.getTime() / 1000)]
}

export const dayNumber = (d: Date) => String(d.getDate())                       // 19
export const dayLine = (d: Date) => `${MONTHS[d.getMonth()]} · ${DAYS[d.getDay()]}` // OCT · MON
export const monthDay = (d: Date) => `${p2(d.getMonth() + 1)}.${p2(d.getDate())}` // 10.19
export const clock = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`    // 13:40

export const dayShort = (d: Date) => `${monthDay(d)} · ${DAYS[d.getDay()]}`        // 10.19 · MON（信息流日期栏）
