interface PlaceholderPageProps {
  title: string;
  description: string;
  milestone: string;
}

export function PlaceholderPage({ title, description, milestone }: PlaceholderPageProps) {
  return (
    <section className="page">
      <div className="empty">
        <strong>{title}</strong>
        <p>{description}</p>
        <span className="chip chip-muted">{milestone}</span>
      </div>
    </section>
  );
}
