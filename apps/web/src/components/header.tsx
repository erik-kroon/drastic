import { Link } from "@tanstack/react-router";
import { ModeToggle } from "./mode-toggle";
import { Navbar } from "./navbar";
import { useState, useEffect } from "react";

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const links = [{ to: "/", label: "drastic" }];

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      if (scrollPosition > 10) {
        setIsScrolled(true);
      } else {
        setIsScrolled(false);
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${
        isScrolled ? "bg-background/70 backdrop-blur-sm" : "bg-transparent"
      }`}
    >
      <div className="w-full flex flex-row items-center justify-between px-8 py-2">
        <nav className="flex  text-xl border-b-muted shadow-none">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              activeProps={{ className: "font-semibold font-lg p-0" }}
              activeOptions={{ exact: true }}
              className="inline-block"
              style={{
                lineHeight: 1,
                margin: 0,
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <span className="inline-flex items-center">
                <span className="h-6 w-6 text-lg rounded-full bg-primary mr-3" />
                {label}
              </span>
            </Link>
          ))}
        </nav>
        <div className=" z-50 flex items-center justify-center">
          <Navbar />
        </div>
        <div className="flex items-center gap-2">
          <div
            className="animate-fade-up flex justify-center"
            style={{ animationDelay: "0.4s" }}
          >
            <a
              href="mailto:erik@drastic.dev"
              className="inline-flex rounded-full items-center justify-center px-4 py-2
              text-xs font-semibold  text-white
              bg-gradient-to-r from-purple-500 to-blue-500
              hover:from-purple-700 hover:to-blue-700
              transition-colors duration-300"
            >
              Contact us
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
