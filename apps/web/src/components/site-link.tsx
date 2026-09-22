import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

export function SiteLink(props: ComponentProps<"a">) {
  const href = props.href;
  if (!href?.startsWith("/") || href.startsWith("//") || props.download) {
    return <a {...props} />;
  }
  const [to, hash] = href.split("#");
  return (
    <Link
      {...props}
      href={undefined}
      to={to}
      hash={hash}
      activeOptions={{ exact: true, includeHash: true }}
    />
  );
}
