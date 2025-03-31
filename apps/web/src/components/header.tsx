import { Link } from "@tanstack/react-router";
import { ModeToggle } from "./mode-toggle";

export default function Header() {
  const links = [{ to: "/", label: "drastic" }];

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <nav className="flex gap-4 text-lg border-none shadow-none">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeProps={{ className: "font-semibold pl-2" }}
              activeOptions={{ exact: true }}
            >
              <span className="inline-flex items-center">
                <span className="h-5 w-5 rounded-full bg-white mr-3"></span>
                {label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>
    </div>
  );
}
