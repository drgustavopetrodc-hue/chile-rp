interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <span className="section-heading__eyebrow">{eyebrow}</span>
      <h2 className="section-heading__title" id={id}>
        {title}
      </h2>
      <p className="section-heading__description">{description}</p>
    </div>
  );
}
