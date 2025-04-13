("use client");

import { GlowingEffect } from "@/lib/components/ui/glowing-effect";

export function ServicesGrid() {
  return (
    <div>
      <h2 className="text-center text-4xl mb-12">we build</h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-2 lg:px-16">
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
