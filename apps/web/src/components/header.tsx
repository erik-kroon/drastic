import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "./navbar";

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
      className={`fixed top-0 left-0 z-50 w-full transition-all duration-300 ${
        isScrolled ? "bg-background/70 backdrop-blur-sm" : "bg-transparent"
      }`}
    >
      <div className="flex w-full flex-row items-center justify-between px-24 py-2">
        <nav className="border-b-muted flex text-xl shadow-none">
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
                <span className="bg-primary mr-3 h-6 w-6 rounded-full text-lg" />
                {label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="z-50 flex items-center justify-center">
          <Navbar />
        </div>
        <div className="flex items-center gap-2">
          <div
            className="animate-fade-up flex justify-center"
            style={{ animationDelay: "0.4s" }}
          >
            <a
              href="mailto:erik@drastic.dev"
              className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-xs font-semibold text-white transition-colors duration-300 hover:from-purple-700 hover:to-blue-700"
            >
              Contact us
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
