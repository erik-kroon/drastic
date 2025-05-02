import { createFileRoute } from "@tanstack/react-router";
import { GridBackground, Spotlight } from "../lib/components/blocks/spotlight";
import FAQ from "../lib/components/sections/faq/default";
import { Hero } from "../lib/components/sections/hero";
import { SecondSection } from "../lib/components/sections/second";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="flex w-full flex-col items-center">
      <Hero />
      <SecondSection />

      <div className="h-[100px] lg:h-[200px]" aria-hidden="true" />
      <FAQ />

      <div className="h-[100px]" aria-hidden="true" />
      <GridBackground />
      <Spotlight />
    </div>
  );
}
