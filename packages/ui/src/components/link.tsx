import {
  createContext,
  useContext,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";

const LinkComponent = createContext<ComponentType<ComponentProps<"a">> | "a">("a");

export function LinkProvider({
  component,
  children,
}: {
  component: ComponentType<ComponentProps<"a">>;
  children: ReactNode;
}) {
  return <LinkComponent value={component}>{children}</LinkComponent>;
}

/** Let the host application supply its router without coupling UI to one router. */
export function Link(props: ComponentProps<"a">) {
  const Component = useContext(LinkComponent);
  return <Component {...props} />;
}
