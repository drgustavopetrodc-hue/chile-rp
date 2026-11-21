import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "RP Chile | Portal institucional",
  description:
    "Portal de un proyecto ficticio de roleplay para representar instituciones y crear historias comunitarias.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="es-CL">
      <body>
        <a className="skip-link" href="#contenido">
          Saltar al contenido principal
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
