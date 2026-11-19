import type { PortalService } from "@/lib/site-data";

export function ServiceCard({ service }: { service: PortalService }) {
  const Icon = service.icon;
  const statusId = `estado-${service.id}`;

  return (
    <article aria-describedby={statusId} className="service-card">
      <div aria-hidden="true" className="service-card__icon">
        <Icon size={23} strokeWidth={1.7} />
      </div>
      <h3 className="service-card__title">{service.title}</h3>
      <p className="service-card__description">{service.description}</p>
      <span className="status-badge" id={statusId}>
        <span aria-hidden="true" className="status-badge__dot" />
        En desarrollo
      </span>
    </article>
  );
}
