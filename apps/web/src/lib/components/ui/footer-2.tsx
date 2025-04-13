import { Button } from "@/lib/components/ui/button";
import { Link } from "@tanstack/react-router";
import { GithubIcon, TwitterIcon } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="w-full flex-col p-6">
      <div className="w-full flex flex-row justify-between items-center">
        <Link
          to={"/"}
          activeProps={{
            className: "font-semibold  p-0",
          }}
          activeOptions={{
            exact: true,
          }}
          className="inline-block transition-all duration-400 ease-in-out"
          style={{
            lineHeight: 1,
            margin: 0,
            padding: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span className="inline-flex items-center text-xl gap-2">
            <span className="bg-primary mr-3 h-6 w-6 rounded-full" />
            drastic
          </span>
        </Link>
        <div className="mt-0 flex list-none space-x-3">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full"
            asChild
          >
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Twitter"
            >
              <TwitterIcon className="h-5 w-5" />
            </a>
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full"
            asChild
          >
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="GitHub"
            >
              <GithubIcon className="h-5 w-5" />
            </a>
          </Button>
        </div>
      </div>
      <div className="mt-4 border-t pt-4 flex justify-between items-center">
        <div className="text-muted-foreground text-sm">© 2025 drastic</div>
        <div className="flex space-x-6">
          <Link
            to="/"
            search={{ page: "privacy" }}
            className="text-muted-foreground text-sm hover:underline"
          >
            Privacy
          </Link>
          <Link
            to="/"
            search={{ page: "terms" }}
            className="text-muted-foreground text-sm hover:underline"
          >
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
};
