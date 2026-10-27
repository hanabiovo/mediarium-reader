import { PageHeader } from '../components/PageHeader'

// 一级页面占位（信息流）：页头已是定稿样式，内容在后续块实现。
export function TopPlaceholder({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <div className="page-body"><p className="page-note">这一页在 3c 后续块实现。</p></div>
    </>
  )
}
