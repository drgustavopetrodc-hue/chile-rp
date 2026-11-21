"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { LoaderCircle, LogOut, Menu, X } from "lucide-react";
import { navigationItems } from "@/lib/site-data";

const authErrorMessages: Record<string, string> = {
  AccessDenied: "No se pudo autorizar el acceso con Discord.",
  Configuration: "El inicio de sesión no está configurado correctamente.",
  OAuthCallback: "Discord no pudo completar la autenticación. Inténtalo otra vez.",
  OAuthSignin: "No se pudo iniciar la autenticación con Discord.",
  Default: "No se pudo iniciar sesión. Inténtalo de nuevo.",
};

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

function DiscordMark() {
  return (
    <svg aria-hidden="true" className="discord-mark" viewBox="0 0 127.14 96.36">
      <path
        fill="currentColor"
        d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.4 0A72.37 72.37 0 0 0 45.35 0 105.89 105.89 0 0 0 19.1 8.09C2.53 32.65-1.96 56.6.29 80.21h.02A105.73 105.73 0 0 0 32.53 96.36a77.7 77.7 0 0 0 6.89-11.14 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2.04a75.76 75.76 0 0 0 64.22 0c.87.7 1.76 1.38 2.66 2.04a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.13 105.25 105.25 0 0 0 32.22-16.15h.02C128.16 52.82 121.46 29.06 107.7 8.07ZM42.45 65.69c-6.28 0-11.46-5.77-11.46-12.86s5.02-12.86 11.46-12.86c6.49 0 11.57 5.82 11.46 12.86.01 7.09-5.02 12.86-11.46 12.86Zm42.24 0c-6.28 0-11.46-5.77-11.46-12.86s5.02-12.86 11.46-12.86c6.49 0 11.57 5.82 11.46 12.86.01 7.09-4.97 12.86-11.46 12.86Z"
      />
    </svg>
  );
}

function AuthControl({
  session,
  status,
  authLoading,
  onSignIn,
  onSignOut,
}: {
  session: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  authLoading: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  if (status === "loading" || authLoading) {
    return (
      <button className="login-button" disabled type="button">
        <LoaderCircle aria-hidden="true" className="spinner" size={16} />
        {status === "loading" ? "Comprobando sesión..." : "Conectando..."}
      </button>
    );
  }

  if (session?.user) {
    return (
      <div className="account-control">
        {session.user.image ? (
          <img
            alt=""
            className="account-control__avatar"
            height={32}
            src={session.user.image}
            width={32}
          />
        ) : (
          <span aria-hidden="true" className="account-control__avatar account-control__fallback">
            {(session.user.name ?? "U").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="account-control__name">{session.user.name ?? "Cuenta de Discord"}</span>
        <button
          aria-label="Cerrar sesión"
          className="logout-button"
          onClick={onSignOut}
          title="Cerrar sesión"
          type="button"
        >
          <LogOut aria-hidden="true" size={16} />
        </button>
      </div>
    );
  }

  return (
    <button className="login-button login-button--discord" onClick={onSignIn} type="button">
      <DiscordMark />
      Iniciar sesión con Discord
    </button>
  );
}

export function SiteHeader() {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { data: session, status } = useSession();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setAuthError(authErrorMessages[code] ?? authErrorMessages.Default);
  }, []);

  async function iniciarSesion() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signIn("discord", { callbackUrl: "/" });
    } catch {
      setAuthError("No se pudo iniciar sesión con Discord. Inténtalo de nuevo.");
      setAuthLoading(false);
    }
  }

  async function cerrarSesion() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signOut({ callbackUrl: "/" });
    } catch {
      setAuthError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      setAuthLoading(false);
    }
  }

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
            <AuthControl
              authLoading={authLoading}
              onSignIn={iniciarSesion}
              onSignOut={cerrarSesion}
              session={session}
              status={status}
            />
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
            <AuthControl
              authLoading={authLoading}
              onSignIn={iniciarSesion}
              onSignOut={cerrarSesion}
              session={session}
              status={status}
            />
          </div>
        </nav>
        {authError ? (
          <p className="site-width auth-error" role="alert">
            {authError}
          </p>
        ) : null}
      </header>
    </>
  );
}
