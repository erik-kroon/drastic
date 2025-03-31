import { BackgroundBeams } from "@/components/beams";
import { cn } from "@/lib/utils";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="min-h-screen container mx-auto w-full px-4 py-2 relative">
      {" "}
      {/* Make container relative */}
      <div className="max-w-3xl mx-auto">
        {/* Interactive Content Container */}
        <div className="interactive-content relative z-10">
          {" "}
          {/* Increased z-index */}
          <div className="flex flex-col items-center justify-center text-center space-y-8 pt-24">
            <h1
              className={cn(
                "text-4xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tighter",
                "animate-fade-up",
              )}
            >
              we help businesses scale with AI
            </h1>

            <p
              className="max-w-2xl lg:text-lg sm:text-md text-primary/80 animate-fade-up"
              style={{ animationDelay: "0.2s" }}
            >
              a digital agency that helps businesses scale through software,
              automation, and AI. we build internal tools and automate processes
              to help save your business time and money.
            </p>

            <div className="animate-fade-up" style={{ animationDelay: "0.4s" }}>
              <a
                href="mailto:erik@drastic.dev"
                className="inline-flex rounded-full items-center justify-center px-8 py-3.5 text-lg font-semibold text-white bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-700 hover:to-blue-700 transition-colors duration-300"
              >
                Get in touch
              </a>
            </div>
          </div>
          <section className="pt-16">
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
          </section>
        </div>
      </div>
      {/* Background Beams (placed after interactive content) */}
      <div className="absolute inset-0 z-0 w-full">
        <BackgroundBeams />
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
