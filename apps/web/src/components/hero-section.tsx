import Link from "next/link";
import { ArrowRight, Check, Landmark } from "lucide-react";

export function HeroSection() {
  return (
    <section aria-labelledby="portada-titulo" className="hero-section" id="inicio">
      <div className="site-width hero-section__inner">
        <div className="hero-copy">
          <p className="eyebrow">Portal institucional · RP Chile</p>
          <h1 className="hero-title" id="portada-titulo">
            Instituciones para construir una{" "}
            <span>comunidad de historias.</span>
          </h1>
          <p className="hero-description">
            RP Chile es un proyecto de roleplay que representa instituciones
            públicas en un entorno narrativo. Un espacio comunitario para crear
            personajes, explorar servicios simulados y compartir historias.
          </p>
          <div className="hero-actions">
            <Link className="button-link button-link--gold" href="#instituciones">
              Conocer las instituciones
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link className="button-link button-link--outline" href="#servicios">
              Acceder al portal
            </Link>
          </div>
        </div>

        <aside aria-label="Naturaleza del proyecto" className="hero-aside">
          <div className="hero-aside__top">
            <p className="hero-aside__label">Una comunidad narrativa</p>
            <p className="hero-aside__stamp">RP · Chile</p>
          </div>
          <div aria-hidden="true" className="my-5 text-[#d3bd8f]">
            <Landmark size={30} strokeWidth={1.4} />
          </div>
          <h2 className="hero-aside__title">
            Un entorno para participar, representar y crear.
          </h2>
          <ul className="hero-aside__list">
            <li className="hero-aside__item">
              <Check aria-hidden="true" size={16} />
              Roleplay comunitario
            </li>
            <li className="hero-aside__item">
              <Check aria-hidden="true" size={16} />
              Instituciones ficticias
            </li>
            <li className="hero-aside__item">
              <Check aria-hidden="true" size={16} />
              Servicios en desarrollo
            </li>
          </ul>
          <p className="hero-aside__note">
            Este portal describe una simulación de roleplay; no representa a
            organismos públicos reales.
          </p>
        </aside>
      </div>
    </section>
  );
}
