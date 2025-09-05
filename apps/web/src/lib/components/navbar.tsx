"use client";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";

export function Navbar({ className }: { className?: string }) {
  return (
    <div
      className={cn("inset-x-0 z-50 mx-auto max-w-2xl flex gap-8", className)}
    >
      <Link
        to={"/work"}
        className="transition-opacity duration-300 hover:opacity-80"
      >
        Previous work
      </Link>

      <Link
        to={"/tanship"}
        className="transition-opacity duration-300 hover:opacity-80"
      >
        Boilerplate
      </Link>
      <Link
        to={"/autoseo"}
        className="transition-opacity duration-300 hover:opacity-80"
      >
        AutoSEO
      </Link>
    </div>
  );
}
