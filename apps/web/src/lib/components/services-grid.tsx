("use client");

import { GlowingEffect } from "@/lib/components/ui/glowing-effect";
import {
  BetterAuth,
  Bun,
  Cloudflare,
  DrizzleORM,
  ElysiaJS,
  Hono,
  Motion,
  Nextjs,
  shadcnui,
  TanStack,
  Threejs,
  TRPC,
} from "./logos";
import { LogoCarousel } from "./ui/logo-carousel";

export function ServicesGrid() {
  return (
    <div>
      <div className="flex flex-col items-center pb-4">
        {/* <h2 className="text-center text-lg mb-8 text-muted-foreground">
          we build secure, modern & scalable solutions
      </h2> */}

        <h3 className="text-center text-primary text-lg font-semibold mb-2">
          we build secure, modern & scalable solutions
        </h3>
      </div>

      <ul className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:px-16 mb-12">
        <FeatureItem
          title="Internal tools"
          description="Custom AI-powered software to streamline your business."
        />
        <FeatureItem
          title="Web applications"
          description="Modern, scalable B2B or B2C applications tailored to your needs. "
        />
        {/* <FeatureItem
          title="AI-powered apps"
          description="Automate tasks to free up time for what truly matters."
        /> */}

        <FeatureItem
          title="MVPs"
          description="Rapid prototype development to validate your business ideas."
        />
        <FeatureItem
          title="Landing pages"
          description="High-converting pages to convert visitors and capture leads."
        />
      </ul>

      <div className="flex flex-col items-center py-8">
        {/* <h2 className="text-center text-lg mb-8 text-muted-foreground">
          powered by battle-tested technology
        </h2> */}
        <h3 className="text-center text-primary text-lg font-semibold mb-2">
          powered by battle-tested technology
        </h3>
      </div>

      <div className="w-full flex justify-center py-6">
        <LogoCarousel
          columnCount={2}
          logos={[
            { name: "TanStack", id: 1, img: TanStack },
            { name: "Bun", id: 2, img: Bun },
            { name: "BetterAuth", id: 3, img: BetterAuth },
            { name: "Hono", id: 4, img: Hono },
            { name: "Drizzle", id: 5, img: DrizzleORM },
            { name: "Cloudflare", id: 6, img: Cloudflare },
            { name: "TRPC", id: 7, img: TRPC },
            { name: "ElysiaJS", id: 8, img: ElysiaJS },
            { name: "shadcn/ui", id: 9, img: shadcnui },
            { name: "next", id: 10, img: Nextjs },
            // { name: "Vercel", id: 11, img: Vercel },
            { name: "Three.js", id: 11, img: Threejs },
            { name: "Motion", id: 12, img: Motion },
          ]}
        ></LogoCarousel>
      </div>
    </div>
  );
}

interface FeatureItemProps {
  title: string;
  description: string;
}

const FeatureItem = ({ title, description }: FeatureItemProps) => {
  return (
    <li className="list-none">
      <div className="border-border bg-secondary/60 relative rounded-[1.25rem] border-[0.75px] p-2 md:rounded-[1rem] md:p-1.5">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={3}
        />
        <div className="bg-background relative flex h-27 w-48 flex-col justify-between gap-3 overflow-hidden rounded-xl border-[0.75px] p-2 shadow-sm md:h-28 md:w-52 dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)]">
          <div className="relative flex flex-1 flex-col justify-between">
            <div className="p-1 px-3">
              <h3 className="text-foreground pt-0 pb-1 font-sans text-sm leading-[1.375rem] font-semibold tracking-[-0.04em] text-balance md:pb-2 md:text-lg">
                {title}
              </h3>
              <h2 className="text-muted-foreground font-sans text-xs leading-[1.125rem] md:text-sm [&_b]:md:font-semibold [&_strong]:md:font-semibold">
                {description}
              </h2>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};
