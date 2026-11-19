import { Info } from "lucide-react";
import { institutions } from "@/lib/site-data";
import { InstitutionCard } from "@/components/institution-card";
import { SectionHeading } from "@/components/section-heading";

export function InstitutionsSection() {
  return (
    <section
      aria-labelledby="instituciones-titulo"
      className="section section--paper"
      id="instituciones"
    >
      <div className="site-width">
        <SectionHeading
          description="Conoce las principales áreas institucionales representadas en las historias de RP Chile. Estas tarjetas son informativas y no corresponden a servicios de organismos reales."
          eyebrow="Estructura institucional"
          id="instituciones-titulo"
          title="Instituciones para dar forma al relato."
        />
        <div className="institution-grid">
          {institutions.map((institution) => (
            <InstitutionCard institution={institution} key={institution.id} />
          ))}
        </div>
        <p className="section-note">
          <Info aria-hidden="true" size={16} />
          <span>
            Las instituciones aquí descritas pertenecen al entorno ficticio del
            proyecto de roleplay.
          </span>
        </p>
      </div>
    </section>
  );
}
