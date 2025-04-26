import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router"; // Import Link from Tanstack Router
import type { AnchorHTMLAttributes, ReactNode } from "react";

type AuroraButtonVariant =
  | "purple-to-blue"
  | "cyan-to-blue"
  | "yellow-to-red"
  | "green-to-teal"
  | "light-purple"; // Added light purple variant

interface AuroraButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  glowClassName?: string;
  href: string;
  size?: "sm" | "md" | "lg";
  glowSize?: "sm" | "md" | "lg";
  variant?: AuroraButtonVariant; // Use variant instead of dynamic colors
  scaleOnHover?: boolean; // Optional flag for size increase on hover
  isExternal?: boolean; // Flag to indicate if the link is external
}

const sizeClasses = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2 text-base",
  lg: "px-8 py-4 text-xl",
};

const glowSizeClasses = {
  sm: "-inset-x-1 inset-y-0 blur-md",
  md: "-inset-x-1.5 inset-y-0.25 blur-lg", // Modified for more horizontal glow
  lg: "-inset-0.5 blur-xl",
};

// Define gradient classes for each variant
const variantClasses: Record<AuroraButtonVariant, string> = {
  "purple-to-blue": "from-purple-600 to-blue-600",
  "cyan-to-blue": "from-cyan-500 to-blue-500",
  "yellow-to-red": "from-amber-700 to-orange-800",
  "green-to-teal": "from-green-500 to-teal-500",
  "light-purple": "from-purple-400 to-blue-400",
};

export function AuroraButton({
  className,
  children,
  glowClassName,
  href,
  size = "lg",
  glowSize,
  variant = "purple-to-blue",
  scaleOnHover = true, // Default to true
  ...props
}: AuroraButtonProps) {
  const buttonSizeClass = sizeClasses[size];
  const glowSizeClass =
    glowSizeClasses[glowSize || size] || glowSizeClasses["lg"];
  // Get gradient classes based on the selected variant
  const gradientClasses = variantClasses[variant];

  const commonClasses = cn(
    "relative cursor-pointer rounded-full bg-gradient-to-r text-white shadow-md transition-all duration-400",
    scaleOnHover && "hover:scale-105 active:scale-95",
    gradientClasses,
    "border-none outline-none",
    "inline-flex items-center justify-center gap-2",
    buttonSizeClass,
    className,
  );

  const style = {
    lineHeight: "1",
  };

  return (
    <div className="group relative inline-flex">
      {/* Gradient border container */}
      <div
        className={cn(
          "absolute z-[-1] rounded-full bg-gradient-to-l opacity-40 transition-all duration-400 group-hover:opacity-85",
          gradientClasses,
          glowSizeClass,
          glowClassName,
        )}
      />
      <Link
        to={href} // Use 'to' prop for internal links
        className={commonClasses}
        style={style}
        resetScroll={true}
        {...props}
      >
        {children}
      </Link>
    </div>
  );
}

/*

{/* Link or Anchor */
// <a
//   href={href}
//   className={commonClasses}
//   style={style}
//   target="_blank" // Often good practice for external links
//   rel="noopener noreferrer" // Security measure for target="_blank"
//   {...props}
// >
//   {children}
// </a>
