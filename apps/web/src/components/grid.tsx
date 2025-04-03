("use client");

import { Box, Lock, Search, Settings, Sparkles } from "lucide-react";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { cn } from "../lib/utils";

export function GlowingEffectDemo() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3">
      <FeatureItem
        title="Internal tools"
        description="Custom software that streamlines workflows."
      />
      <FeatureItem
        title="Web applications"
        description="Modern, scalable web applications tailored to your needs."
      />
      <FeatureItem
        title="Automation"
        description="Automate repetitive tasks to free up valuable time."
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
  );
}

interface FeatureItemProps {
  title: string;
  description: string;
}

const FeatureItem = ({ title, description }: FeatureItemProps) => {
  return (
    <li className="list-none ">
      <div className="relative  rounded-[1.25rem] border-[0.75px] border-border p-2 md:rounded-[1.5rem] md:p-3">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={3}
        />
        <div className="relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl border-[0.75px] bg-background shadow-sm dark:shadow-[0px_0px_27px_0px_rgba(45,45,45,0.3)] md:p-4">
          <div className="relative flex flex-1 flex-col justify-between ">
            <div className="p-1 px-2 ">
              <h3 className="pb-2 text-lg leading-[1.375rem] font-semibold font-sans tracking-[-0.04em] text-balance text-foreground">
                {title}
              </h3>
              <h2 className="h-18 [&_b]:md:font-semibold [&_strong]:md:font-semibold font-sans text-sm leading-[1.125rem] text-muted-foreground">
                {description}
              </h2>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};
