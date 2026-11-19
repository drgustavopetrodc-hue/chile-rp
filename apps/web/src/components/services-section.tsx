import { portalServices } from "@/lib/site-data";
import { SectionHeading } from "@/components/section-heading";
import { ServiceCard } from "@/components/service-card";

export function ServicesSection() {
  return (
    <section
      aria-labelledby="servicios-titulo"
      className="section"
      id="servicios"
    >
      <div className="site-width">
        <SectionHeading
          description="El portal se construirá por etapas. Estos accesos anticipan áreas previstas y no habilitan trámites, consultas ni gestiones por ahora."
          eyebrow="Servicios del portal"
          id="servicios-titulo"
          title="Un punto de partida para futuros servicios."
        />
        <div className="service-grid">
          {portalServices.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
      </div>
    </section>
  );
}
