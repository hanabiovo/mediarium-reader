// 本机存储的薄封装：隐私模式等情况下 localStorage 可能抛错，统一兜住。
export function load(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function save(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 忽略 */ }
}
export function remove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* 忽略 */ }
}
