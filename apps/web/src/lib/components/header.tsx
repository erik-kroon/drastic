import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { AuroraButton } from "./aurora-button";
import { Navbar } from "./navbar";

export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const links = [{ to: "/", label: "drastic" }];

  const isMobile = useIsMobile();

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
        isScrolled ? "bg-background/40 backdrop-blur-sm" : "bg-transparent"
      }`}
    >
      <div className="flex w-full flex-row items-center justify-between gap-2 px-12 py-2 md:px-24">
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
          {!isMobile && <Navbar />}
        </div>
        <AuroraButton
          className="animate-fade-up z-50 flex justify-center whitespace-nowrap"
          style={{ animationDelay: "0.4s" }}
          href="mailto:erik@drastic.dev"
          size="sm"
          glowSize="sm"
        >
          Contact us
          <ArrowRightIcon className="ml-1.5 h-5 w-5 transition-transform duration-300 group-hover:translate-x-0.5" />
        </AuroraButton>
      </div>
    </div>
  );
}
