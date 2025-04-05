import { createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { AuroraButton } from "../lib/components/aurora-button";
import { GridBackground, Spotlight } from "../lib/components/blocks/spotlight-new";
import { ServicesGrid } from "../lib/components/services-grid";
import ColourfulText from "../lib/components/ui/colourful-text";
import { HeroPill } from "../lib/components/ui/hero-pill";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(() => ["scale", "grow", "streamline"], []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (titleNumber === titles.length - 1) {
        setTitleNumber(0);
      } else {
        setTitleNumber(titleNumber + 1);
      }
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [titleNumber, titles]);

  return (
    <div className="flex w-full justify-center">
      <GridBackground />
      <Spotlight />
      <div className="interactive-content relative z-10 flex w-full max-w-3xl flex-col items-center px-8">
        <div className="flex flex-col items-center justify-center space-y-8 text-center">
          <HeroPill
            text="1 spot left for April"
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="8"
                height="8"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
            }
            className="pt-18 pb-1"
          />
          <h1
            className={cn(
              "text-4xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl",
              "animate-fade-up",
            )}
          >
            we help businesses
            <br />
            <span className="mx-1 md:mx-2">
              {" "}
              <ColourfulText text="scale" />
            </span>
            with AI
          </h1>
        </div>

        <div
          className="animate-fade-up flex flex-col items-center justify-center gap-8 pt-8 pb-12 sm:pt-12 sm:pb-16 md:flex-row"
          style={{ animationDelay: "0.4s" }}
        >
          <p
            className="text-primary/94 animate-fade-up max-w-2xl text-center text-lg sm:text-lg"
            style={{ animationDelay: "0.2s" }}
          >
            drastic is a digital agency that helps your business save money and grow
            through software, automation and AI.
          </p>

          <AuroraButton
            className="animate-fade-up z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
            style={{ animationDelay: "0.4s" }}
            href="mailto:erik@drastic.dev"
          >
            Book a call
            <ArrowRightIcon className="ml-3 h-8 w-8 transition-transform duration-300 group-hover:translate-x-2" />
          </AuroraButton>
        </div>
        <ServicesGrid />
      </div>
    </div>
  );
}
