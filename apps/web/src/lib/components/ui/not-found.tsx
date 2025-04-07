import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { Button } from "./button";

const NotFoundComponent = () => {
  return (
    <div className="z-50 flex h-screen w-full flex-col items-center justify-start gap-4 space-y-2 pt-48">
      <h1 className="from-primary to-muted-foreground mb-8 bg-gradient-to-br bg-clip-text text-9xl font-bold tracking-tighter text-transparent drop-shadow-sm">
        404
      </h1>
      <p>The page you are looking for does not exist.</p>
      <p className="flex flex-wrap items-center gap-8">
        <Button className="z" type="button" onClick={() => window.history.back()}>
          Go back
        </Button>
        <Button asChild variant="secondary">
          <Link to="/">Home</Link>
        </Button>
      </p>
    </div>
  );
};

export const NotFound = memo(NotFoundComponent);
