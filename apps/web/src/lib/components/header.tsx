import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRightIcon } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react"; // Import useCallback and memo
import { AuroraButton } from "./aurora-button";

// Move links outside the component as it's static data
const links = [
  {
    to: "/",
    label: "drastic",
  },
];

const Header = memo(function Header() {
  const [isScrolled, setIsScrolled] = useState(false);

  // Memoize handleScroll using useCallback as it's used in useEffect
  const handleScroll = useCallback(() => {
    const scrollPosition = window.scrollY;
    if (scrollPosition > 10) {
      setIsScrolled(true);
    } else {
      setIsScrolled(false);
    }
  }, []); // Empty dependency array because handleScroll doesn't depend on any component state or props

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]); // Add handleScroll to the dependency array of useEffect

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.2 }}
    >
      <div
        className={`fixed top-0 left-0 z-50 w-full transition-all duration-600 ease-in-out ${
          isScrolled ? "bg-background/40 backdrop-blur-sm" : "bg-transparent"
        }`}
      >
        <div
          className={`flex w-full z-50 flex-row items-center justify-between gap-2  transition-all duration-600 ease-out ${
            isScrolled ? "py-3 px-6 md:px-12" : "py-6  px-12 md:px-24"
          }`}
        >
          <nav className="border-b-muted flex text-xl shadow-none">
            <Link
              to={links[0].to}
              resetScroll={true}
              activeProps={{
                className: "font-semibold font-lg p-0",
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
              <span className="font-semibold  text-primary inline-flex items-center">
                <span className="  bg-primary mr-3 h-6 w-6 rounded-full text-lg" />
                {links[0].label}
              </span>
            </Link>
          </nav>
          {/* <Navbar></Navbar> */}
          <AuroraButton
            className="z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
            style={{
              animationDelay: "0.4s",
            }}
            href="https://cal.com/drastic"
            size="sm"
            glowSize="sm"
          >
            Contact us
            <ArrowRightIcon className="ml-1.5 h-5 w-5 transition-transform duration-400 ease-in-out group-hover:translate-x-0.5" />
          </AuroraButton>
        </div>
      </div>
    </motion.div>
  );
});

export default Header; // Export the memoized component
