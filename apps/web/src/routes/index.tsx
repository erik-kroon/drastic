import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { GlowingEffectDemo } from "../components/grid";
import ColourfulText from "../components/ui/colourful-text";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className=" w-full flex justify-center">
      <div className=" max-w-3xl  flex flex-col justify-evenly items-center w-full px-4 lg:pt-26 pt-20 gap-16   interactive-content relative z-10 ">
        <div className="flex flex-col items-center justify-center text-center space-y-8">
          <h1
            className={cn(
              "text-4xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter",
              "animate-fade-up",
            )}
          >
            we help businesses
            <span className="ml-4">
              <ColourfulText text="scale" />
            </span>
            with AI
          </h1>

          <p
            className="max-w-2xl lg:text-lg sm:text-md text-primary/80 animate-fade-up"
            style={{ animationDelay: "0.2s" }}
          >
            a digital agency that helps businesses save money and grow through
            software, automation, and AI. we build web applications, internal
            tools and automate processes to help save your business time and
            money.
          </p>
        </div>

        <div
          className="animate-fade-up flex justify-center"
          style={{ animationDelay: "0.4s" }}
        >
          <a
            href="mailto:erik@drastic.dev"
            className="inline-flex mb-2 rounded-full items-center justify-center px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-700 hover:to-blue-700 transition-colors duration-300"
          >
            Get in touch
          </a>
        </div>

        <GlowingEffectDemo />
      </div>
    </div>
  );
}

function FeatureItem({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <li className="border-l-2 border-primary py-1 pl-5">
      <div className="h-full">
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </li>
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
