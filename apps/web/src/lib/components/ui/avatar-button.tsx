import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@radix-ui/react-avatar";
import { PlusIcon } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

interface RoundedAvatarProps {
  src: string;
  alt: string;
  className?: string;
}

const glowSizeClasses = {
  sm: "-inset-x-1 inset-y-0 blur-md",
  md: "-inset-x-1.5 inset-y-0.25 blur-lg", // Modified for more horizontal glow
  lg: "-inset-x-2 inset-y-0.5 blur-xl",
};

interface AvatarButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode;
  href: string;
  size?: "sm" | "md" | "lg";
  withAvatar?: boolean;
  mainAvatarSrc?: string;
  mainAvatarAlt?: string;
  // secondaryAvatarSrc is removed
  // secondaryAvatarAlt is removed
  glow?: boolean; // Optional glow prop, defaults to false
  glowClassName?: string; // Optional className for the glow element
  glowSize?: "sm" | "md" | "lg"; // Optional glow size
}

const sizeClasses = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2 text-base",
  lg: "px-6 py-4 text-lg",
};

const RoundedAvatar = ({ src, alt, className }: RoundedAvatarProps) => {
  return (
    <Avatar
      className={cn(
        "h-8 w-8 shrink-0 transition-all duration-700 ease-in-out rounded-full flex items-center justify-center ring-1 ring-border",
        className,
      )}
    >
      {/* Only render AvatarImage if src is provided */}
      {src ? (
        <AvatarImage
          src={src}
          alt={alt}
          className="object-cover rounded-full"
        />
      ) : null}
      <AvatarFallback>{alt}</AvatarFallback>
    </Avatar>
  );
};

export function AvatarButton({
  className,
  children,
  href,
  size = "md",
  withAvatar = false,
  mainAvatarSrc,
  mainAvatarAlt = "me",
  // secondaryAvatarSrc and secondaryAvatarAlt are removed from destructuring
  glow = false, // Default glow to false
  glowClassName,
  glowSize,
  ...props
}: AvatarButtonProps) {
  const buttonSizeClass = sizeClasses[size];
  const glowSizeClass =
    glowSizeClasses[glowSize || size] || glowSizeClasses["md"]; // Default glow size based on button size

  return (
    <div className="group relative inline-flex">
      {/* Optional Gradient Glow */}
      {glow && (
        <div
          className={cn(
            "absolute z-[-1] rounded-full bg-gradient-to-l opacity-40 transition-all duration-400 group-hover:opacity-85",
            "from-purple-600 to-blue-600", // Using the same gradient as the button
            glowSizeClass, // Default glow size based on button size
            "md:group-hover:-inset-x-5", // Adjust glow size on hover to account for scaling and expansion
            glowClassName,
          )}
        />
      )}

      {/* Main Link Button */}
      <a
        href={href}
        className={cn(
          "bg-gradient-to-r from-purple-600 to-blue-600 border-white border-1",
          "relative cursor-pointer rounded-full  text-white shadow-md transition-all duration-200",
          "hover:scale-115 active:scale-100",
          "border-none outline-none",
          "inline-flex items-center justify-center",
          buttonSizeClass,
          className,
        )}
        style={{
          lineHeight: "1",
        }}
        {...props}
      >
        {withAvatar ? (
          // Added px-4 padding to the content div when withAvatar is true
          <div className="flex items-center gap-4  pr-1">
            {/* Avatar section with expanding capability */}
            <div
              className={cn(
                "relative flex text-[11px] items-center",
                "w-8",
                "md:group-hover:w-[calc(16px+32px+16px+32px)]", // gap + main avatar + gap + second avatar
                "transition-[width] duration-500 ease-in-out",
              )}
            >
              {/* Main Avatar */}
              <RoundedAvatar
                src={mainAvatarSrc || ""}
                alt={mainAvatarAlt}
                className="bg-muted-foreground border-1 border-zinc-500 relative z-20"
              />

              {/* Hidden Stack that appears on hover */}
              <div
                className={cn(
                  "absolute top-0 left-0",
                  "flex items-center gap-2",
                  "transition-all duration-500 ease-in-out",
                  "opacity-0 invisible",
                  "md:group-hover:opacity-100 md:group-hover:visible md:group-hover:translate-x-[calc(66%)]", // Translate to the right of the main avatar + gap
                  "pointer-events-none",
                )}
              >
                <PlusIcon className="h-5 w-5 shrink-0 text-primary" />
                {/* Always the 'you' avatar with text */}
                <div
                  className={cn(
                    "h-8 w-8 shrink-0 rounded-full flex items-center justify-center", // Size and shape
                    "bg-gray-600/70", // Background
                    "text-zinc-200 text-[11px] font-semibold", // Text style
                    "border-1 border-zinc-500/40", // Border
                    "p-0", // Remove padding
                    "text-center", // Center text
                  )}
                >
                  you
                </div>
              </div>
            </div>
            {/* Text Content */}
            <span className="whitespace-nowrap transition-all duration-500 ease-in-out">
              {children}
            </span>
          </div>
        ) : (
          // Added px-4 padding to the content div when withAvatar is false
          <div className="flex items-center gap-2 px-4">{children}</div>
        )}
      </a>
    </div>
  );
}

// import { cn } from "@/lib/utils";
// import { Avatar, AvatarFallback, AvatarImage } from "@radix-ui/react-avatar";
// import { PlusIcon } from "lucide-react";
// import { Button } from "./button";

// const RoundedAvatar = ({
//   src,
//   alt,
//   className,
// }: {
//   src: string;
//   alt: string;
//   className?: string;
//   textClassName?: string;
// }) => {
//   return (
//     <Avatar
//       className={cn(
//         "h-8 w-8 shrink-0 transition-all duration-500 ease-in-out rounded-full flex items-center justify-center ring-1 ring-border",
//         className,
//       )}
//     >
//       <AvatarImage src={src} alt={alt} className="object-cover rounded-full" />
//       <AvatarFallback>{alt}</AvatarFallback>
//     </Avatar>
//   );
// };

// export const AvatarButton = () => {
//   return (
//     <Button
//       variant={"outline"}
//       className={cn(
//         "group relative h-auto px-6 py-2",
//         "transition-all duration-500 ease-in-out rounded-full",
//         "bg-gradient-to-l from-purple-500 to-blue-500",
//       )}
//     >
//       <div className="flex items-center gap-4">
//         {" "}
//         {/* Fixed gap for avatar-to-text spacing */}
//         {/* Avatar section with expanding capability */}
//         <div
//           className={cn(
//             "relative flex items-center",
//             "w-8", // Initial width (just the avatar)
//             "group-hover:w-[calc(8px+32px+20px+32px)]", // hover width: gap + avatar + icon + avatar
//             "transition-[width] duration-500 ease-in-out",
//           )}
//         >
//           {/* Main Avatar */}
//           <RoundedAvatar
//             src="https://media.licdn.com/dms/image/v2/C4E03AQGU6pdKYmHYLw/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1653492715062?e=1750896000&v=beta&t=KfuVrWvw_ee0J34YKVkGv2qinG1G_9wSKWIANiVGyoY"
//             alt="Me"
//             className="bg-muted-foreground border-1 border-zinc-500/40 relative z-20"
//           />

//           {/* Hidden Stack */}
//           <div
//             className={cn(
//               "absolute top-0 left-0",
//               "flex items-center gap-2",
//               "transition-all duration-500 ease-in-out",
//               "opacity-0 invisible",
//               "group-hover:opacity-100 group-hover:visible group-hover:translate-x-[calc(70%)]",
//             )}
//           >
//             <PlusIcon className="h-5 w-5 shrink-0 text-muted/60" />
//             <RoundedAvatar
//               src="/second-avatar.jpg"
//               alt="You"
//               className="bg-muted-foreground text-zinc-700 text-semibold border-zinc-500/40 border-1  p-2 text-[11px]"
//               textClassName="text-blue-500"
//             />
//           </div>
//         </div>
//         {/* Text */}
//         <span className="whitespace-nowrap transition-all duration-500 ease-in-out">
//           Book a 15-min call
//         </span>
//       </div>
//     </Button>
//   );
// };
