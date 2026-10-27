// 二级页面的「返回」与「回到标签首页」。
// 从应用内点进来的页面，在历史记录里带着 depth（报刊架 → 杂志目录是 1，再进文章是 2）。
// 有 depth：返回就是退一步，回首页就是退 depth 步，和手机 app 一样不堆历史；
// 没有 depth（直接打开链接、刷新后）：退无可退，就替换成上一级页面。
import { useLocation, useNavigate } from 'react-router-dom'

export type DeepState = { depth?: number } | null

export function depthOf(state: unknown): number {
  return (state as DeepState)?.depth ?? 0
}

// toTop：退回 parentPath 那一层，而不只是退一步。
// 宽屏上目录和文章并排，这时目录的返回要越过文章直接回报刊架。
export function useBack(parentPath: string, toTop = false) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const depth = depthOf(state)
  return () => (depth > 0 ? navigate(toTop ? -depth : -1) : navigate(parentPath, { replace: true }))
}
