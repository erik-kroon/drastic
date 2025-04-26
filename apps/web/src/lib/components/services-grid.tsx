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
import { AvatarButton } from "./ui/avatar-button";
import { LogoCarousel } from "./ui/logo-carousel";

export function ServicesGrid() {
  return (
    <div>
      <div className="flex flex-col items-center pb-4">
        {/* <h2 className="text-center text-lg mb-8 text-muted-foreground">
          we build secure, modern & scalable solutions
      </h2> */}

        <p className="text-center text-primary text-3xl font-semibold ">
          we build secure, modern & scalable solutions of any kind
          <br />
          <p className="text-muted-foreground text-2xl">
            but this is what we're best at
          </p>
        </p>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-8 lg:px-16 py-8 pb-12 place-items-center">
        <FeatureItem
          title="Internal tools"
          description="Custom AI-powered software to streamline your business."
        />
        <FeatureItem
          title="Web applications"
          description="Modern, scalable B2B or B2C applications tailored to your needs. "
        />

        <FeatureItem
          title="AI-powered apps"
          description="Automate tasks to free up time for what truly matters."
        />
        <FeatureItem
          title="Mobile applications"
          description="Modern cross-platform apps for iOS and Android built with Expo."
        />

        <FeatureItem
          title="MVPs"
          description="Rapid prototype development to validate your business ideas."
        />
        <FeatureItem
          title="Landing pages"
          description="High-converting pages to convert visitors and capture leads."
        />
      </ul>

      <div className="flex flex-col items-center pb-4">
        {/* <h2 className="text-center text-lg mb-8 text-muted-foreground">
          powered by battle-tested technology
        </h2> */}
        <h3 className="text-center text-primary text-lg font-semibold mb-2">
          powered by state-of-the-art tools
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
      <div className="flex flex-row w-full justify-center pt-16">
        <AvatarButton
          href="https://cal.com/drastic"
          withAvatar={true}
          mainAvatarSrc="https://media.licdn.com/dms/image/v2/C4E03AQGU6pdKYmHYLw/profile-displayphoto-shrink_400_400/profile-displayphoto-shrink_400_400/0/1653492715062?e=1750896000&v=beta&t=TLW2CGwLMW6XxHXiVSiY8sG9LM7OkF600naE23AmbPA"
          secondaryAvatarSrc="/path/to/secondary-avatar.jpg"
          mainAvatarAlt="me"
          secondaryAvatarAlt="you"
        >
          Book a 15-min call
        </AvatarButton>
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
    <li className="w-full max-w-[256px] h-full list-none">
      <div className="border-border bg-secondary/60 relative rounded-[1.25rem] border-[0.75px] p-2 md:rounded-[1rem] md:p-1.5 h-full">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={3}
        />
        <div className="bg-background relative flex h-full flex-col justify-between gap-3 overflow-hidden rounded-xl border-[0.75px] p-2 shadow-sm dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)]">
          <div className="relative flex flex-1 flex-col">
            <div className="p-1 px-3 flex flex-col h-full">
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
