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

const defaultFAQItems: FAQItemProps[] = [
  {
    question: "How can AI actually help my business?",
    answer: (
      <>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          AI can transform your business by automating repetitive workflows,
          freeing up your team to focus on strategic, high-impact tasks. It
          boosts productivity by streamlining processes and provides
          data-driven insights to make smarter decisions.
        </p>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          At Drastic, we identify specific opportunities where AI can deliver
          measurable results, from optimizing operations to enhancing customer
          experiences, ultimately driving growth and efficiency.
        </p>
      </>
    ),
  },
  {
    question: "Why should I invest in custom software?",
    answer: (
      <>
        <p className="text-muted-foreground mb-4 max-w-[600px]">
          While off-the-shelf software offers generic solutions, custom software
          is built around your unique product vision and business needs. It's
          like the difference between a ready-made suit and a tailored one –
          the fit and function are unparalleled.
        </p>
        <p className="text-muted-foreground mb-4 max-w-[600px]">
          With a Drastic custom solution, you get a product people love using
          because it’s designed for them. It scales with you, integrates
          seamlessly, and gives you a distinct competitive advantage by
          perfectly aligning technology with your strategic goals.
        </p>
      </>
    ),
  },
  {
    question: "How can Drastic specifically help my business succeed?",
    answer: (
      <>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          We don't just build products; we build experiences that drive
          results. Drastic helps you define and refine your product vision,
          strategizing with you to ensure we're building something people truly
          want and need.
        </p>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          Our expertise in AI and automation, combined with modern software
          development, allows us to create solutions that streamline your
          operations, unlock new efficiencies, and position your business for
          sustainable growth and innovation.
        </p>
      </>
    ),
  },
  {
    question: "What's it like working with Drastic?",
    answer: (
      <>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          Collaboration is at the heart of our process. It begins with a
          discovery call where we listen to understand your vision and
          challenges. Together, we'll outline your needs, identify bottlenecks,
          and pinpoint processes ripe for AI-driven automation or optimization.
        </p>
        <p className="text-muted-foreground mb-4 max-w-[640px] text-balance">
          We then move to build, iterate, and launch, keeping you involved every
          step of the way. After launch, our partnership continues; we work with
          you to iterate on your product, ensuring it evolves with your business
          and continues to deliver value.
        </p>
      </>
    ),
  },
];

export default function FAQ({
  title = "Frequently Asked Questions",
  items = defaultFAQItems,
  className,
}: FAQProps) {
  return (
    <Section className={className}>
      <div className="flex justify-center w-full">
        <div className="pt-8 flex max-w-3xl flex-col items-center gap-8">
          <h2 className="text-center text-3xl font-semibold sm:text-5xl">
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