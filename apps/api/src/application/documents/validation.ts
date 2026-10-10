import * as Documents from "@open-erp/contracts/document-signatures";
import {
  assembleIxbrl,
  displayDecimals,
  type IxbrlContext,
  type IxbrlFact,
} from "@open-erp/domain/annual-report";
import * as Result from "effect/Result";
import * as Effect from "effect/Effect";
import { digest } from "../json";
import { newId } from "../identifiers";
import { artifactBasis, recordCommand, type Command } from "./support";

const concepts = new Map([
  ["assets", "se:Assets"],
  ["equity", "se:Equity"],
  ["liabilities", "se:Liabilities"],
  ["profit", "se:ProfitLossForTheYear"],
  ["revenue", "se:Revenue"],
]);

function attribute(text: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}="([^"]+)"`, "u").exec(text)?.[1];
}

function unescapeXml(text: string) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

export const validateSignatureDocument = (
  token: string,
  command: Command<typeof Documents.ValidateDocument.Type>,
) =>
  recordCommand(
    token,
    command,
    "document_validations",
    Documents.DocumentValidation,
    "validate_signature_document",
    null,
    (transaction) =>
      Effect.gen(function* () {
        const basis = yield* artifactBasis(transaction, command.scope, command.input.artifactId);
        const { artifact, presentation, final } = basis;
        const diagnostics: string[] = [];
        const mappedFacts: IxbrlFact[] = [];
        const contexts: IxbrlContext[] = [];

        const units = [
          ...artifact.xhtml.matchAll(
            /<xbrli:unit id="([^"]+)"><xbrli:measure>iso4217:([^<]+)<\/xbrli:measure><\/xbrli:unit>/gu,
          ),
        ].map((match) => unescapeXml(match[1] ?? ""));

        for (const match of artifact.xhtml.matchAll(
          /<ix:nonFraction ([^>]+)>(-?[0-9]+)<\/ix:nonFraction>/gu,
        )) {
          const attributes = match[1] ?? "";
          mappedFacts.push({
            concept: unescapeXml(attribute(attributes, "name") ?? ""),
            contextRef: unescapeXml(attribute(attributes, "contextRef") ?? ""),
            unitRef: unescapeXml(attribute(attributes, "unitRef") ?? ""),
            decimals: attribute(attributes, "decimals") ?? "",
            valueMinor: match[2] ?? "",
          });
        }

        for (const match of artifact.xhtml.matchAll(
          /<xbrli:context id="([^"]+)"><xbrli:entity><xbrli:identifier scheme="http:\/\/www.renskal.se\/se\/orgnr">([^<]+)<\/xbrli:identifier><\/xbrli:entity><xbrli:period>(.*?)<\/xbrli:period><\/xbrli:context>/gu,
        )) {
          const dates = match[3] ?? "";
          const instant = /<xbrli:instant>([^<]+)<\/xbrli:instant>/u.exec(dates)?.[1];
          const start = /<xbrli:startDate>([^<]+)<\/xbrli:startDate>/u.exec(dates)?.[1];
          const end = /<xbrli:endDate>([^<]+)<\/xbrli:endDate>/u.exec(dates)?.[1];
          contexts.push({
            contextRef: unescapeXml(match[1] ?? ""),
            entityIdentifier: unescapeXml(match[2] ?? ""),
            period: instant ?? `${start ?? ""}/${end ?? ""}`,
            dimensions: [],
          });
        }

        const expected = presentation.revision.facts.map((fact) => ({
          concept: concepts.get(fact.semanticId),
          valueMinor: fact.sourceMinor,
        }));

        if (
          expected.some((fact) => !fact.concept) ||
          mappedFacts.length !== expected.length ||
          expected.some(
            (fact) =>
              mappedFacts.filter(
                (extracted) =>
                  extracted.concept === fact.concept &&
                  extracted.valueMinor === fact.valueMinor &&
                  extracted.decimals === displayDecimals(presentation.revision.displayRule),
              ).length !== 1,
          )
        )
          diagnostics.push("Stored XHTML does not exactly cover supported semantic facts.");

        if (
          contexts.some(
            (context) =>
              context.entityIdentifier !== command.scope.entityId ||
              !context.period.endsWith(`${final.summary.fiscalYear}-12-31`),
          )
        )
          diagnostics.push("Stored context entity or fiscal-year identity differs.");

        const assembly = assembleIxbrl({
          report: final.summary,
          presentation: presentation.revision,
          mappedFacts,
          contexts,
          units,
          taxonomyRelease: artifact.taxonomyRelease,
          unmappedConcepts: [],
        });

        if (Result.isFailure(assembly) || assembly.success.xhtml !== artifact.xhtml)
          diagnostics.push("Stored XHTML differs from the bounded synthetic semantic grammar.");

        return {
          id: newId("document_validation"),
          artifactId: artifact.id,
          artifactHash: basis.hash,
          artifactLength: basis.length,
          modelDigest: final.summary.modelDigest,
          presentationDigest: presentation.digest,
          extractedFactsDigest: yield* digest(mappedFacts),
          profile: "synthetic-xhtml-v1",
          result: diagnostics.length === 0 ? "passed" : "failed",
          diagnostics,
        };
      }),
  );
