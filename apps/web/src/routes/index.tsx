import { createFileRoute } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { GlowingEffectDemo } from "/src/components/grid";
import ColourfulText from "/src/components/ui/colourful-text";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="flex min-h-screen w-full justify-center">
      <div className="interactive-content relative z-10 flex w-full max-w-3xl flex-col items-center justify-evenly gap-16 px-4 pt-20 lg:pt-26">
        <div className="flex flex-col items-center justify-center space-y-8 text-center">
          <h1
            className={cn(
              "text-4xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl",
              "animate-fade-up",
            )}
          >
            we help businesses
            <span className="ml-4">
              <ColourfulText text="scale" />
            </span>
            <br />
            with AI
          </h1>
        </div>

        <div
          className="animate-fade-up flex items-center justify-center"
          style={{ animationDelay: "0.4s" }}
        >
          <p
            className="text-primary/94 animate-fade-up max-w-2xl sm:text-xl lg:text-xl"
            style={{ animationDelay: "0.2s" }}
          >
            drastic is a digital agency that helps your business save money and grow
            through software, automation and AI
          </p>

          <div className="group ml-8 flex h-16 shrink-0 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 px-8 text-center font-semibold text-white transition-colors duration-300 hover:from-purple-700 hover:to-blue-700">
            <a
              href="mailto:erik@drastic.dev"
              className="flex items-center justify-center gap-3"
            >
              <span className="text-xl">Book a call</span>
              <ArrowRightIcon className="h-8 w-8 transition-transform duration-300 group-hover:translate-x-1.25" />
            </a>
          </div>
        </div>

        <GlowingEffectDemo />
      </div>
    </div>
  );
}

{
  /* <section className="">
  <ul className="grid grid-cols-2 gap-3 ">
    <FeatureItem
      title="Internal tools"
      description="Custom software that streamlines workflows."
    />
    <FeatureItem
      title="Automation"
      description="Automate repetitive tasks to free up valuable time."
    />
    <FeatureItem
      title="Web applications"
      description="Modern, scalable web applications tailored to your needs."
    />
    <FeatureItem
      title="MVPs"
      description="Rapid prototype development and validation of your business ideas."
    />
    <FeatureItem
      title="Landing pages"
      description="High-converting pages to convert visitors and capture leads."
    />
    <FeatureItem
      title="AI Marketing"
      description="Cutting-edge strategies for unparalleled campaign performance."
    />
  </ul>
</section> */
}
