import { motion } from "framer-motion";
import { ArrowLeftIcon } from "lucide-react";
import { useRef } from "react";
import { AuroraButton } from "../aurora-button";
import { Card, CardContent } from "../ui/card";
export const Work = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const textWrapperRef = useRef<HTMLDivElement>(null);

  const projects = [
    {
      title: "Drastic Dashboard Analytics",
      description:
        "Advanced analytics and reporting features for data-driven insights.",
      imageSrc: "/drastic_dashboard_2.png",
      altText: "Drastic Dashboard Analytics View",
    },
    {
      title: "autoseo.dev",
      description: "Grow organic traffic on autopilot.",
      imageSrc: "/autoseo.png",
      altText: "autoseo waitlist",
    },
    {
      title: "Drastic Calendar",
      description:
        "A modern calendar application with intuitive scheduling and event management capabilities.",
      imageSrc: "/drastic_calendar.png",
      altText: "Drastic Calendar Interface",
    },

    {
      title: "Drastic Dashboard",
      description:
        "Comprehensive dashboard solution for monitoring and managing business metrics.",
      imageSrc: "/drastic_dashboard.png",
      altText: "Drastic Dashboard View",
    },
  ];

  return (
    <section
      ref={sectionRef}
      className="max-w-4xl min-h-screen bg-background p-8"
    >
      <motion.div
        animate={{ opacity: [0, 1] }}
        transition={{ duration: 1.69 }}
        className="container mx-auto px-4"
      >
        <div className="space-y-4 text-center mb-16 relative z-10">
          <div ref={textWrapperRef}>
            <h2 className="text-2xl font-semibold text-foreground">
              previous work
            </h2>
          </div>
        </div>
        {/* <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-8 w-full">
          {projects.map((project) => (
            <Card
              className="relative p-0 overflow-hidden"
              key={project.altText}
            >
              <CardContent className="px-0">
                <img
                  src={project.imageSrc}
                  alt={project.altText}
                  className="w-full h-64 object-cover"
                  loading="eager"
                />
              </CardContent>
            </Card>
          ))}
        </div> */}

        <Card className="relative my-8 p-0 overflow-hidden">
          <CardContent className="px-0">
            <img
              src={"/autoseo_2.png"}
              alt={"waitlist"}
              className="w-full h-full object-cover"
              loading="eager"
            />
          </CardContent>
        </Card>

        <motion.div className="flex flex-col gap-8 w-full items-center ">
          {projects.map((project) => (
            <Card
              className="relative max-w-4xl p-0 pr-0 overflow-hidden"
              key={project.altText}
            >
              <CardContent className="px-0">
                <img
                  src={project.imageSrc}
                  alt={project.altText}
                  className="w-full"
                  loading="lazy"
                />
              </CardContent>
            </Card>
          ))}
        </motion.div>
      </motion.div>
      <div className="w-full flex justify-center py-16">
        <AuroraButton
          className="animate-fade-up z-40 whitespace-nowrap px-8 gap-4 pr-10"
          style={{
            animationDelay: "0.4s",
          }}
          size="md"
          href="/"
          variant="yellow-to-red"
          withPreview={true}
          staticPreviewImage="/home.png"
        >
          <ArrowLeftIcon className=" mt-0.25 h-8 w-8 transition-transform duration-300 group-hover:-translate-x-1.25" />
          Go back
        </AuroraButton>
      </div>
    </section>
  );
};
