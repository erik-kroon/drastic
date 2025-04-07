import * as React from "react";

import { cn } from "src/lib/utils";

function Section({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="section"
      className={cn("bg-background text-foreground px-4 py-16", className)}
      {...props}
    />
  );
}

export { Section };
