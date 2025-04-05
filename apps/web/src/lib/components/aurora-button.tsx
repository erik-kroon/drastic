import { cn } from "@/lib/utils";
import type { AnchorHTMLAttributes, ReactNode } from "react";

interface AuroraButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  glowClassName?: string;
  href: string;
  size?: "sm" | "md" | "lg"; // Add a size prop
  glowSize?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2 text-base",
  lg: "px-8 py-4 text-xl",
};

const glowSizeClasses = {
  sm: "-inset-0.25 blur-lg",
  md: "-inset-0.1875 blur-lg",
  lg: "-inset-0.5 blur-xl",
};

export function AuroraButton({
  className,
  children,
  glowClassName,
  href,
  size = "lg", // Default to large
  glowSize,
  ...props
}: AuroraButtonProps) {
  const buttonSizeClass = sizeClasses[size];
  const glowSizeClass = glowSizeClasses[glowSize || size] || glowSizeClasses["lg"];

  return (
    <div className="group relative inline-flex">
      {/* Gradient border container */}
      <div
        className={cn(
          "absolute z-[-1] rounded-full bg-gradient-to-r from-purple-600 to-blue-600 opacity-0 transition-all duration-200 group-hover:opacity-85",
          glowSizeClass,
          glowClassName,
        )}
      />

      {/* Link */}
      <a
        href={href}
        className={cn(
          "relative cursor-pointer rounded-full bg-gradient-to-r from-purple-600 to-blue-600 font-semibold text-white shadow-md transition-all duration-200 hover:scale-105 active:scale-95",
          "border-none outline-none",
          "inline-flex items-center justify-center gap-2",
          buttonSizeClass, // Apply size class
          className,
        )}
        style={{ lineHeight: "1" }}
        {...props}
      >
        {children}
      </a>
    </div>
  );
}
