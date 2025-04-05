("use client");

import { GlowingEffect } from "@/lib/components/ui/glowing-effect";

export function ServicesGrid() {
  return (
    <ul className="grid grid-cols-3 gap-3 lg:grid-cols-3">
      <FeatureItem
        title="Internal tools"
        description="Custom software to streamline your business."
      />
      <FeatureItem
        title="Web applications"
        description="Modern, scalable web applications tailored to your needs."
      />
      <FeatureItem
        title="AI Workflows"
        description="Automate tasks to free up time for what truly matters."
      />

      <FeatureItem
        title="MVPs"
        description="Rapid prototype development to validate your business ideas."
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
        <div className="bg-background relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl border-[0.75px] shadow-sm md:p-4 dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)]">
          <div className="relative flex flex-1 flex-col justify-between">
            <div className="p-1 px-2 pl-3">
              <h3 className="text-foreground pb-2 font-sans text-lg leading-[1.375rem] font-semibold tracking-[-0.04em] text-balance">
                {title}
              </h3>
              <h2 className="text-muted-foreground h-14 font-sans text-sm leading-[1.125rem] [&_b]:md:font-semibold [&_strong]:md:font-semibold">
                {description}
              </h2>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};
