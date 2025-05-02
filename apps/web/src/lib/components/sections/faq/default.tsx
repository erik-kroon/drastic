import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../../ui/accordion";
import { Section } from "../../ui/section";

interface FAQItemProps {
  question: string;
  answer: ReactNode;
  value?: string;
}

interface FAQProps {
  title?: string;
  items?: FAQItemProps[] | false;
  className?: string;
}

export default function FAQ({
  title = "Questions and Answers",
  items = [
    {
      question: "How can automation and AI help my business save money?",
      answer: (
        <>
          <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
            In today's competitive landscape, automation and AI can streamline
            your operations, reduce manual work, and help your team focus on
            high-value tasks.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
            Our solutions help identify and eliminate inefficiencies while
            scaling your capabilities without scaling costs.
          </p>
        </>
      ),
    },
    {
      question:
        "Why do I need custom software instead of off-the-shelf solutions?",
      answer: (
        <>
          <p className="text-muted-foreground mb-4 max-w-[600px]">
            Generic software often means compromising on functionality or paying
            for features you don't need. Custom solutions are built specifically
            for your unique business processes and goals.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[600px]">
            As your business grows, custom software grows with you - no need to
            switch platforms or deal with integration headaches.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[600px]">
            With custom internal tools, you get exactly what your business
            needs, optimized for your workflow and ready to scale.
          </p>
        </>
      ),
    },
    {
      question:
        "How does Drastic's approach differ from other digital agencies?",
      answer: (
        <>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            We focus specifically on creating solutions that drive measurable
            cost savings and growth through modern technology.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            Our expertise in automation and AI means we can identify
            opportunities others miss to streamline your operations.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
            We build long-term partnerships focused on your business success,
            not just delivering a project and moving on.
          </p>
        </>
      ),
    },
    {
      question: "What types of businesses do you work with?",
      answer: (
        <>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            We work with businesses of all sizes who are looking to grow through
            technology and automation.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            Whether you're a startup looking to scale efficiently or an
            established company seeking to modernize operations, we can help
            create custom solutions for your needs.
          </p>
        </>
      ),
    },
    {
      question: "How do you ensure solutions scale with my business?",
      answer: (
        <p className="text-muted-foreground mb-4 max-w-[580px]">
          We design all our solutions with scalability in mind from day one. Our
          modern technology stack and focus on automation means your tools can
          handle growth without requiring constant rebuilds or updates.
        </p>
      ),
    },
    {
      question: "What's the process of working with Drastic?",
      answer: (
        <>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            We start with understanding your business goals and current
            challenges. Then we identify opportunities for automation and
            improvement, create a strategic plan, and implement solutions that
            drive real results.
          </p>
          <p className="text-muted-foreground mb-4 max-w-[580px]">
            Ready to learn more? Don't hesitate to{" "}
            <a
              href="mailto:contact@drastic.com"
              className="text-foreground underline"
            >
              reach out to us
            </a>
            .
          </p>
        </>
      ),
    },
  ],
  className,
}: FAQProps) {
  return (
    <Section className={className}>
      <div className="flex justify-center w-full">
        <div className="pt-8 flex max-w-3xl flex-col items-center gap-8">
          <h2 className="text-center text-3xl font-semibold sm:text-5xl whitespace-nowrap">
            {title}
          </h2>
          {items !== false && items.length > 0 && (
            <div className="relative w-[300px] md:w-[600px]">
              <Accordion type="single" collapsible>
                {items.map((item, index) => (
                  <AccordionItem
                    key={item.question}
                    value={item.value || `item-${index + 1}`}
                  >
                    <AccordionTrigger>{item.question}</AccordionTrigger>
                    <AccordionContent>{item.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
