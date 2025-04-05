import {
  ErrorComponent,
  type ErrorComponentProps,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
} from "@tanstack/react-router";

import { Button } from "./button";

export function DefaultCatchBoundary({ error }: Readonly<ErrorComponentProps>) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });

  console.error(error);

  return (
    <div>
      <div className="mt-64 flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-4">
        <ErrorComponent error={error} />
        <div className="flex items-center gap-4">
          <Button
            type="button"
            onClick={() => {
              router.invalidate();
            }}
          >
            Try Again
          </Button>
          {isRoot ? (
            <Button asChild variant="secondary">
              <Link to="/">Home</Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link
                to="/"
                onClick={(e: React.FormEvent) => {
                  e.preventDefault();
                  window.history.back();
                }}
              >
                Go Back
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
