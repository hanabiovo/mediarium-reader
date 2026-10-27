// 双语标题（阶段 4，Hana 定：译文在上，原文小字在下，像报纸的副题）
export function TitleText({ title, zh, className }: { title: string; zh?: string; className: string }) {
  if (!zh) return <span className={className}>{title}</span>
  return (
    <>
      <span className={className}>{zh}</span>
      <span className="title-orig" lang="und">{title}</span>
    </>
  )
}
