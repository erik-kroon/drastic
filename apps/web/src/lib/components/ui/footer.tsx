import { Button } from "@/lib/components/ui/button";
import { GithubIcon, TwitterIcon } from "lucide-react";

interface FooterProps {
  logo: React.ReactNode;
  brandName: string;
  socialLinks: Array<{
    icon: React.ReactNode;
    href: string;
    label: string;
  }>;
  mainLinks: Array<{
    href: string;
    label: string;
  }>;
  legalLinks: Array<{
    href: string;
    label: string;
  }>;
  copyright: {
    text: string;
    license?: string;
  };
}

function FooterComponent() {
  return (
    <div className="w-full">
      <Footer
        logo={<span className="bg-primary mr-3 h-6 w-6 rounded-full text-lg" />}
        brandName="drastic"
        socialLinks={[
          {
            icon: <TwitterIcon className="h-5 w-5" />,
            href: "https://twitter.com",
            label: "Twitter",
          },
          {
            icon: <GithubIcon className="h-5 w-5" />,
            href: "https://github.com",
            label: "GitHub",
          },
        ]}
        mainLinks={[
          { href: "/products", label: "Products" },
          { href: "/about", label: "About" },
          { href: "/blog", label: "Blog" },
          { href: "/contact", label: "Contact" },
        ]}
        legalLinks={[
          { href: "/privacy", label: "Privacy" },
          { href: "/terms", label: "Terms" },
        ]}
        copyright={{
          text: "© 2024 drastic",
          license: "All rights reserved",
        }}
      ></Footer>
    </div>
  );
}

export { FooterComponent as Footer };

function Footer({
  logo,
  brandName,
  socialLinks,
  mainLinks,
  legalLinks,
  copyright,
}: FooterProps) {
  return (
    <footer className="pt-16 pb-6 lg:pt-24 lg:pb-8">
      <div className="px-4 lg:px-8">
        <div className="md:flex md:items-start md:justify-between">
          <a href="/" className="flex items-center gap-x-2" aria-label={brandName}>
            {logo}
            <span className="text-xl font-bold">{brandName}</span>
          </a>
          <ul className="mt-6 flex list-none space-x-3 md:mt-0">
            {socialLinks.map((link) => (
              <li key={link.label}>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  asChild
                >
                  <a href={link.href} target="_blank" aria-label={link.label}>
                    {link.icon}
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 border-t pt-6 md:mt-4 md:pt-8 lg:grid lg:grid-cols-10">
          <nav className="lg:col-[4/11] lg:mt-0">
            <ul className="-mx-2 -my-1 flex list-none flex-wrap lg:justify-end">
              {mainLinks.map((link) => (
                <li key={link.href} className="mx-2 my-1 shrink-0">
                  <a
                    href={link.href}
                    className="text-primary text-sm underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-6 lg:col-[4/11] lg:mt-0">
            <ul className="-mx-3 -my-1 flex list-none flex-wrap lg:justify-end">
              {legalLinks.map((link, i) => (
                <li key={i} className="mx-3 my-1 shrink-0">
                  <a
                    href={link.href}
                    className="text-muted-foreground text-sm underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="text-muted-foreground mt-6 text-sm leading-6 whitespace-nowrap lg:col-[1/4] lg:row-[1/3] lg:mt-0">
            <div>{copyright.text}</div>
            {copyright.license && <div>{copyright.license}</div>}
          </div>
        </div>
      </div>
    </footer>
  );
}
