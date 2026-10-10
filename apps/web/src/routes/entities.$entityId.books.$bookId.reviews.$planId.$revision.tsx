import * as Schema from "effect/Schema";
import { createFileRoute } from "@tanstack/react-router";
import { OwnerReviewQuery } from "@/lib/work-return";
import { ReviewScreen } from "@/components/review-screen";

export const Route = createFileRoute("/entities/$entityId/books/$bookId/reviews/$planId/$revision")(
  { component: Review, validateSearch: Schema.decodeUnknownSync(OwnerReviewQuery) },
);

function Review() {
  const filters = Route.useSearch();
  const { planId, revision } = Route.useParams();

  return <ReviewScreen planId={planId} revision={revision} filters={filters} />;
}
