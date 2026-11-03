interface PlaceholderPageProps {
  title: string;
  description: string;
  milestone: string;
}

export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">ROADMAP · {milestone}</p>
          <h1>{title}</h1>
          <p className="lead">{description}</p>
        </div>
      </header>
      <div className="empty">
        <strong>这一步还没开始</strong>
        <p>当前先完成 M0 应用壳与 M1 内核接入；这个页面会在后续里程碑接入真实数据。</p>
      </div>
    </section>
  );
}
