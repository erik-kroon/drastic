import { cn } from "src/lib/utils";

interface HeroPillProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  text: string;
  className?: string;
  /**
   * @default true
   */
  animate?: boolean;
}

export function HeroPill({
  icon,
  text,
  className,
  animate = true,
  ...props
}: HeroPillProps) {
  return (
    <div
      className={cn("mb-0", animate && "animate-slide-up-fade", className)}
      {...props}
    >
      <p className="bg-background text-foreground dark:bg-accent hover:bg-accent/80 inline-flex items-center justify-center rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap shadow-sm shadow-black/[.12] transition-colors">
        {icon && (
          <span className="border-border mr-2 flex shrink-0 border-r pr-2">
            {icon}
          </span>
        )}
        {text}
      </p>
    </div>
  );
}

export function StarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      fill="none"
      className="transition-transform duration-300 group-hover:scale-110"
    >
      <path
        className="fill-zinc-500"
        d="M6.958.713a1 1 0 0 0-1.916 0l-.999 3.33-3.33 1a1 1 0 0 0 0 1.915l3.33.999 1 3.33a1 1 0 0 0 1.915 0l.999-3.33 3.33-1a1 1 0 0 0 0-1.915l-3.33-.999-1-3.33Z"
      />
    </svg>
  );
}
