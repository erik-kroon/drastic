import { Card, CardContent } from "../ui/card";

export const Work = () => {
  const projects = [
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
    {
      title: "Drastic Dashboard Analytics",
      description:
        "Advanced analytics and reporting features for data-driven insights.",
      imageSrc: "/drastic_dashboard_2.png",
      altText: "Drastic Dashboard Analytics View",
    },
  ];

  return (
    <section className="w-full min-h-screen bg-background pt-8">
      <div className="container mx-auto px-4">
        <div className="space-y-4 text-center mb-16 relative z-10">
          <h2 className="text-2xl font-semibold text-foreground">
            previous work
          </h2>
          {/* <AuroraButton
            className="z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
            href="mailto:erik@drastic.dev"
          >
            Schedule a call
            <ThickArrowRightIcon className="ml-3 h-8 w-8 mt-0.25 transition-transform duration-500 group-hover:translate-x-2" />
          </AuroraButton> */}
        </div>

        <div className="flex flex-col gap-16 w-full items-center">
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
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
