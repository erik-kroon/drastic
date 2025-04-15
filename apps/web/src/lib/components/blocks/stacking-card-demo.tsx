"use client";

import { useEffect, useRef } from "react";
import { Card } from "../../components/ui/card";
import { cn } from "../../utils";
import StackingCards, { StackingCardItem } from "./stacking-cards";

const images = [
  {
    src: "/drastic_dashboard_2.png",
    alt: "Dashboard 2",
    title: "Modern Dashboard",
    description:
      "Experience our intuitive dashboard with powerful analytics and real-time insights.",
  },
  {
    src: "/drastic_dashboard.png",
    alt: "Dashboard",
    title: "Data Visualization",
    description:
      "Transform complex data into clear, actionable insights with our advanced visualization tools.",
  },
  {
    src: "/drastic_calendar.png",
    alt: "Calendar",
    title: "Smart Calendar",
    description:
      "Stay organized with our intelligent calendar system, designed for maximum productivity.",
  },
];

export default function StackingCardDemo() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const elementTop = rect.top;
      const elementHeight = rect.height;

      // Calculate how far the element is through the viewport
      const progress =
        (viewportHeight - elementTop) / (viewportHeight + elementHeight);
      const clampedProgress = Math.max(0, Math.min(1, progress));

      // Apply the scroll position to the container
      const maxScroll =
        containerRef.current.scrollHeight - containerRef.current.clientHeight;
      containerRef.current.scrollTop = maxScroll * clampedProgress;
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Initial position

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-[100vh] flex items-center justify-center">
      <div
        className="h-[2000px] w-full overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        ref={containerRef}
      >
        <StackingCards
          totalCards={images.length}
          scrollOptons={{ container: containerRef }}
        >
          {images.map((image, index) => (
            <StackingCardItem
              key={image.src}
              index={index}
              className="h-[620px]"
            >
              <Card
                className={cn(
                  "h-[80%] sm:h-[70%] aspect-video w-11/12 mx-auto relative overflow-hidden rounded-lg bg-card",
                )}
              >
                <img
                  src={image.src}
                  alt={image.alt}
                  className="w-full h-full object-cover"
                />
              </Card>
            </StackingCardItem>
          ))}
        </StackingCards>
      </div>
    </div>
  );
}
