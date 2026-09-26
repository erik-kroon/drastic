import type { ComponentProps } from "react";
import { Link, useRouter } from "@tanstack/react-router";

export function SiteLink(props: ComponentProps<"a">) {
  const router = useRouter();
  const href = props.href;

  if (!href?.startsWith("/") || href.startsWith("//") || props.download) {
    return <a {...props} />;
  }

  const target = new URL(href, "http://openerp.invalid");

  return (
    <Link
      {...props}
      href={undefined}
      to={target.pathname}
      search={() => router.options.parseSearch(target.search)}
      hash={target.hash.slice(1)}
      activeOptions={{ exact: true, includeHash: true }}
    />
  );
}
