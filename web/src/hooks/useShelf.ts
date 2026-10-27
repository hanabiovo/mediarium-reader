// 报刊架数据（分类 + 信源）：先给缓存，后台刷新；别处改了信源会自动更新。
import { useEffect, useState } from 'react'
import { cachedShelf, loadShelf, subscribeShelf, type ShelfData } from '../api/miniflux'

export function useShelf(): { data: ShelfData | null; error: string } {
  const [data, setData] = useState<ShelfData | null>(cachedShelf)
  const [error, setError] = useState('')
  useEffect(() => {
    const off = subscribeShelf(setData)
    loadShelf().catch((e) => setError(String((e as Error).message)))
    return off
  }, [])
  return { data, error }
}
