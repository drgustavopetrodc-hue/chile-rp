import {
  Building2,
  ClipboardList,
  FileText,
  Landmark,
  Scale,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  label: string;
  href: string;
}

export const navigationItems: NavigationItem[] = [
  { label: "Inicio", href: "#inicio" },
  { label: "Instituciones", href: "#instituciones" },
  { label: "Gobierno", href: "#gobierno" },
  { label: "Poder Judicial", href: "#poder-judicial" },
  { label: "Fiscalía", href: "#fiscalia" },
  { label: "Servicios", href: "#servicios" },
];

export interface Institution {
  id: string;
  title: string;
  category: string;
  description: string;
  icon: LucideIcon;
}

export const institutions: Institution[] = [
  {
    id: "gobierno",
    title: "Gobierno de Chile",
    category: "Administración",
    description:
      "Espacio para la coordinación y representación del gobierno dentro del roleplay.",
    icon: Landmark,
  },
  {
    id: "poder-judicial",
    title: "Poder Judicial",
    category: "Justicia",
    description:
      "Ámbito narrativo para la resolución de causas y el desarrollo de historias judiciales.",
    icon: Scale,
  },
  {
    id: "fiscalia",
    title: "Ministerio Público",
    category: "Investigación",
    description:
      "Representación ficticia de la investigación penal en el entorno de RP Chile.",
    icon: ShieldCheck,
  },
  {
    id: "contraloria",
    title: "Contraloría General",
    category: "Control público",
    description:
      "Referencia institucional para tramas de control y probidad dentro de la comunidad.",
    icon: ClipboardList,
  },
  {
    id: "otras-instituciones",
    title: "Otras instituciones del Estado",
    category: "Servicio público",
    description:
      "Organismos y servicios representados como parte de las historias del proyecto.",
    icon: Building2,
  },
];

export interface PortalService {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const portalServices: PortalService[] = [
  {
    id: "identidad",
    title: "Identidad y cédula",
    description:
      "Espacio proyectado para consultar la identidad de tu personaje y su cédula de roleplay.",
    icon: UserRound,
  },
  {
    id: "instituciones",
    title: "Instituciones",
    description:
      "Información y orientación sobre las instituciones representadas en la comunidad.",
    icon: Landmark,
  },
  {
    id: "tramites",
    title: "Trámites",
    description:
      "Accesos a procesos narrativos y solicitudes que se incorporarán en futuras etapas.",
    icon: ClipboardList,
  },
  {
    id: "documentos",
    title: "Documentos",
    description:
      "Consulta de documentos de roleplay cuando esta sección esté disponible.",
    icon: FileText,
  },
];
