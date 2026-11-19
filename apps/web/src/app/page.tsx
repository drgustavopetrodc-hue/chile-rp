import { HeroSection } from "@/components/hero-section";
import { InstitutionsSection } from "@/components/institutions-section";
import { ServicesSection } from "@/components/services-section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="contenido">
        <HeroSection />
        <InstitutionsSection />
        <ServicesSection />
      </main>
      <SiteFooter />
    </>
  );
}
