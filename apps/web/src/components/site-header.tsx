"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { navigationItems } from "@/lib/site-data";

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {navigationItems.map((item) => (
        <Link
          className="navigation-link"
          href={item.href}
          key={item.href}
          onClick={onNavigate}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

function LoginButton() {
  return (
    <button
      className="login-button"
      disabled
      title="El acceso al portal estará disponible en una etapa posterior."
      type="button"
    >
      Iniciar sesión
      <span className="login-button__status">Próximamente</span>
    </button>
  );
}

export function SiteHeader() {
  const [menuAbierto, setMenuAbierto] = useState(false);

  return (
    <>
      <div className="utility-bar">
        <div className="site-width utility-bar__inner">
          <p>Portal institucional · RP Chile</p>
          <p>Proyecto ficticio de roleplay</p>
        </div>
      </div>
      <header className="site-header">
        <div className="site-width site-header__inner">
          <Link className="brand" href="#inicio">
            <span aria-hidden="true" className="brand__seal">
              RP
            </span>
            <span className="brand__wordmark">
              RP CHILE
              <span className="brand__caption">Portal institucional</span>
            </span>
          </Link>

          <nav aria-label="Navegación principal" className="desktop-navigation">
            <NavigationLinks />
          </nav>

          <div className="desktop-login">
            <LoginButton />
          </div>

          <div className="mobile-navigation">
            <button
              aria-controls="navegacion-movil"
              aria-expanded={menuAbierto}
              aria-label={menuAbierto ? "Cerrar navegación" : "Abrir navegación"}
              className="mobile-navigation__toggle"
              onClick={() => setMenuAbierto(!menuAbierto)}
              type="button"
            >
              {menuAbierto ? (
                <X aria-hidden="true" size={20} />
              ) : (
                <Menu aria-hidden="true" size={20} />
              )}
            </button>
          </div>
        </div>
        <nav
          aria-label="Navegación móvil"
          className="mobile-navigation__panel"
          hidden={!menuAbierto}
          id="navegacion-movil"
        >
          <div className="site-width">
            <NavigationLinks onNavigate={() => setMenuAbierto(false)} />
            <LoginButton />
          </div>
        </nav>
      </header>
    </>
  );
}
