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

      <div className="relative z-10">
        <div className="absolute inset-0 h-[800px]">
          <FAQ />
        </div>
      </div>
      <div className="h-[800px]" aria-hidden="true" />
      <GridBackground />
      <Spotlight />
    </div>
  );
}
