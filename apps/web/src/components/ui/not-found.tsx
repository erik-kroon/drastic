import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { Button } from "../ui/button";

const NotFoundComponent = () => {
  return (
    <div className="w-full h-screen flex flex-col justify-start pt-48 items-center gap-4 space-y-2">
      <h1 className=" mb-8   text-9xl font-bold tracking-tighter bg-gradient-to-br from-primary to-muted-foreground bg-clip-text text-transparent drop-shadow-sm">
        404
      </h1>
      <p>The page you are looking for does not exist.</p>
      <p className="flex flex-wrap items-center  gap-8">
        <Button
          className=""
          type="button"
          onClick={() => window.history.back()}
        >
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
