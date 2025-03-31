import { Zap } from "lucide-react";

const services = [
  {
    title: "B2B Enterprise SaaS",
    description:
      "Custom enterprise software solutions that streamline operations and drive business growth for B2B companies.",
  },
  {
    title: "Landing Pages",
    description:
      "High-converting, strategic landing pages designed to capture leads and communicate your value proposition effectively.",
  },
  {
    title: "MVP Development",
    description:
      "Rapid development of minimum viable products to validate your business idea and attract early adopters and investors.",
  },
  {
    title: "Web Applications",
    description:
      "Scalable, feature-rich web applications built with modern technologies and best practices for optimal performance.",
  },
  {
    title: "Digital Transformation",
    description:
      "End-to-end digital strategy and implementation to modernize your business processes and customer experiences.",
  },
  {
    title: "UX/UI Design",
    description:
      "User-centered design that balances aesthetics with functionality to create intuitive and engaging digital experiences.",
  },
  {
    title: "AI Business Automation",
    description:
      "Streamline operations and reduce costs by automating repetitive business tasks and workflows using advanced AI technologies.",
    icon: <Zap className="w-6 h-6 mb-3" />,
  },
];

const ServicesSection = () => {
  return (
    <section id="services" className="py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Our Services
          </h2>
          <p className="mt-4 max-w-2xl mx-auto">
            We specialize in building powerful digital solutions that drive
            business growth and transformation.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <div
              key={index}
              className="p-8 bg-accent/40 rounded-lg shadow-sm transition-all duration-300 hover:shadow-md hover:translate-y-[-5px]"
            >
              {service.icon}
              <h3 className="text-xl font-semibold mb-3">{service.title}</h3>
              <p className="text-sm">{service.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
