import type { Institution } from "@/lib/site-data";

export function InstitutionCard({ institution }: { institution: Institution }) {
  const Icon = institution.icon;

  return (
    <article className="institution-card" id={institution.id}>
      <div aria-hidden="true" className="institution-card__icon">
        <Icon size={20} strokeWidth={1.7} />
      </div>
      <p className="institution-card__category">{institution.category}</p>
      <h3 className="institution-card__title">{institution.title}</h3>
      <p className="institution-card__description">{institution.description}</p>
    </article>
  );
}
