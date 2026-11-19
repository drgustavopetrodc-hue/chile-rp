import Link from "next/link";
import { navigationItems } from "@/lib/site-data";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-width site-footer__main">
        <div>
          <Link
            aria-label="RP Chile, volver al inicio"
            className="brand site-footer__brand"
            href="#inicio"
          >
            <span aria-hidden="true" className="brand__seal">
              RP
            </span>
            <span className="brand__wordmark">
              RP CHILE
              <span className="brand__caption">Portal institucional</span>
            </span>
          </Link>
          <p className="site-footer__description">
            Un proyecto comunitario de roleplay inspirado en la representación
            institucional y la creación de historias compartidas.
          </p>
        </div>
        <nav aria-label="Navegación del pie de página">
          <h2 className="site-footer__heading">Navegación institucional</h2>
          <ul className="site-footer__links">
            {navigationItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="site-width site-footer__disclaimer">
        <p>
          RP Chile es un proyecto ficticio de roleplay. No tiene carácter
          oficial ni relación con organismos reales del Estado chileno.
        </p>
      </div>
    </footer>
  );
}
