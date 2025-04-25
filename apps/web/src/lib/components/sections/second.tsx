import { ArrowRightIcon } from "@radix-ui/react-icons";
import { AuroraButton } from "../aurora-button";
import { ServicesGrid } from "../services-grid";
import { useTheme } from "../theme-provider";
import { Card, CardContent } from "../ui/card";
import { ProgressiveBlur } from "../ui/progressive-blur";
import { Sparkles } from "../ui/sparkles";

export function SecondSection() {
  const { theme } = useTheme();
  return (
    <div className=" w-full overflow-hidden">
      <div className="mx-auto mt-48  w-full max-w-2xl">
        <div className="relative  h-[100px] w-full">
          <ProgressiveBlur
            className="pointer-events-none absolute top-0 left-0 h-full w-[200px]"
            direction="left"
            blurIntensity={1}
          />
          <ProgressiveBlur
            className="pointer-events-none absolute top-0 right-0 h-full w-[200px]"
            direction="right"
            blurIntensity={1}
          />
        </div>
      </div>
      <div className="relative -mt-64 h-96 w-full overflow-hidden [mask-image:radial-gradient(50%_50%,white,transparent)]">
        <div className="absolute inset-0 before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_bottom_center,#8350e8,transparent_70%)] before:opacity-40" />
        <div className="absolute top-1/2 -left-1/2 z-10 aspect-[1/0.6] w-[200%] rounded-[100%] border-t border-zinc-900/20 bg-white dark:border-white/20 dark:bg-zinc-900" />
        <Sparkles
          density={1200}
          className="absolute inset-x-0 bottom-0 h-full w-full [mask-image:radial-gradient(50%_50%,white,transparent_85%)]"
          color={theme === "dark" ? "#ffffff" : "#000000"}
        />
      </div>
      <div className="h-[1400px] sm:h-[1400px] md:h-[1400px]  text-4xl w-full flex justify-center items-center flex-col gap-12">
        <div className="px-4 w-full flex justify-center flex-col items-center gap-4">
          <div className="flex flex-col gap-2 pb-2 text-center">
            <div>Your own internal tools. Built uniquely for you.</div>
            <div className="text-2xl text-zinc-600 dark:text-zinc-400">
              Your business is unique - your software should be too.
            </div>
            <div className="text-2xl text-zinc-600 dark:text-zinc-400">
              We create solutions that scale with your growth.
            </div>
          </div>

          {/* <div className="pb-4">
            <BorderBeamImage imagePath="/drastic_dashboard.png" />
          </div> */}

          <Card className="relative max-w-4xl p-0 pr-0 overflow-hidden">
            <CardContent className="px-0">
              <img
                src={"/drastic_dashboard_2.png"}
                alt="dashboard_2"
                className="w-full"
              />
            </CardContent>
          </Card>
        </div>
        <AuroraButton
          className="animate-fade-up z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
          style={{
            animationDelay: "0.4s",
          }}
          size="md"
          href="mailto:erik@drastic.dev"
        >
          Book a 15-min call
          <ArrowRightIcon className="ml-3 h-8 w-8 transition-transform duration-300 group-hover:translate-x-1" />
        </AuroraButton>
        <ServicesGrid />
        {/* <div className="px-4 md:px-8 flex flex-col gap-8">
          <BorderBeamImage imagePath="/drastic_calendar.png" reverse={true} />
        </div> */}
        {/* <AuroraButton
          className="animate-fade-up z-50 mt-4 flex justify-center whitespace-nowrap md:mt-0"
          style={{
            animationDelay: "0.4s",
          }}
          size="md"
          href="mailto:erik@drastic.dev"
        >
          Book a 15-min call
          <ArrowRightIcon className="ml-3 h-8 w-8 transition-transform duration-300 group-hover:translate-x-1" />
        </AuroraButton> */}
      </div>
      <div className="relative  h-96 w-full overflow-hidden [mask-image:radial-gradient(50%_50%,white,transparent)]">
        <div className="absolute inset-0 before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_top_center,#8350e8,transparent_70%)] before:opacity-40" />
        <div className="absolute bottom-1/2 -left-1/2 z-10 aspect-[1/0.5] w-[200%] rotate-180 rounded-[100%] border-t border-zinc-900/20 bg-white dark:border-white/20 dark:bg-zinc-900" />
        <Sparkles
          density={1200}
          className="absolute inset-x-0 top-0 h-full w-full [mask-image:radial-gradient(50%_50%,white,transparent_85%)]"
          color={theme === "dark" ? "#ffffff" : "#000000"}
        />
      </div>
    </div>
  );
}
