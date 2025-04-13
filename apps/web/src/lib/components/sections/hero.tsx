import { ArrowRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { AuroraButton } from "../aurora-button";
import ColourfulText from "../ui/colourful-text";
import { HeroPill } from "../ui/hero-pill";

export function Hero() {
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
    <div className=" min-h-[calc(80vh)] interactive-content relative z-10 flex w-full max-w-4xl flex-grow flex-col justify-center items-center px-8 lg:max-w-4xl gap-16">
      <HeroPill
        text="2 spots left"
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
            <circle cx="12" cy="12" r="10" fill="#11CC2A" />
          </svg>
        }
        className="pt-24 lg:pt-12"
      />
      <div className="flex flex-col items-center justify-center space-y-8 text-center">
        <h1
          className={cn(
            " text-5xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl",
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
        className="animate-fade-up flex flex-col items-center justify-center gap-8 md:flex-row"
        style={{
          animationDelay: "0.4s",
        }}
      >
        <p
          className="text-primary/94 animate-fade-up max-w-md pr-0 text-left text-lg sm:text-lg"
          style={{
            animationDelay: "0.2s",
          }}
        >
          drastic is a digital agency that helps your business save money and
          grow through software, automation and AI.
        </p>

        <AuroraButton
          className="animate-fade-up z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
          style={{
            animationDelay: "0.4s",
          }}
          href="mailto:erik@drastic.dev"
        >
          Schedule a call
          <ArrowRightIcon className="ml-3 h-8 w-8 transition-transform duration-300 group-hover:translate-x-2" />
        </AuroraButton>
      </div>
      <div className="absolute bottom-0"></div>
    </div>
  );
}
