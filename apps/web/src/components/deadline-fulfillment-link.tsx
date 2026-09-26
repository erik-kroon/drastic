import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Deadlines from "@open-erp/contracts/deadlines";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

type Deadline = typeof Deadlines.Deadline.Type;

const kinds = ["artifact", "attempt", "external"] as const;

const artifactOwners = ["accountant_review_artifact", "sie_transaction_artifact"] as const;

const environments = ["production", "sandbox"] as const;

type Kind = (typeof kinds)[number];

function artifactOwner(value: string) {
  return Schema.decodeUnknownSync(
    Schema.Literals(["accountant_review_artifact", "sie_transaction_artifact"]),
  )(value);
}

function environment(value: string) {
  return Schema.decodeUnknownSync(Deadlines.FulfillmentEnvironment)(value);
}

function SelectInput(props: {
  label: string;
  value: string;
  options: ReadonlyArray<string>;
  onSelect: (value: string) => void;
}) {
  return (
    <label>
      {props.label}{" "}
      <select value={props.value} onChange={(event) => props.onSelect(event.target.value)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DeadlineFulfillmentLink(props: {
  obligation: Deadline;
  path: string;
  locale: Locale;
  onError: (error: Error) => void;
  onLinked: () => Promise<void>;
}) {
  const { obligation, path, locale } = props;
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const [kind, setKind] = useState<Kind>("artifact");
  const [owner, setOwner] = useState<string>(artifactOwners[0]);
  const [artifactId, setArtifactId] = useState("");
  const [revision, setRevision] = useState("");
  const [digest, setDigest] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [originalRef, setOriginalRef] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [assertedMeaning, setAssertedMeaning] = useState("");
  const [target, setTarget] = useState<string>("production");

  const link = useMutation({
    mutationFn: () => {
      const reference = Schema.decodeUnknownSync(Deadlines.FulfillmentReference)(
        payloadFor(kind, environment(target)),
      );

      const endpoint = `${path}/${encodeURIComponent(obligation.id)}/fulfillments`;
      const body = JSON.stringify({ reference });

      return readAccounting(
        endpoint,
        Deadlines.FulfillmentResult,
        mutationOptions(endpoint, body, keys.current),
      );
    },
    onSuccess: async () => await props.onLinked(),
    onError: props.onError,
  });

  function payloadFor(
    selected: Kind,
    selectedEnvironment: typeof Deadlines.FulfillmentEnvironment.Type,
  ) {
    if (selected === "attempt") {
      return {
        kind: "submitted_attempt",
        owner: "ar_legal_delivery_attempt",
        attemptId: attemptId.trim(),
        digest: digest.trim(),
        environment: selectedEnvironment,
      };
    }

    if (selected === "external") {
      return {
        kind: "reviewed_external_evidence",
        originalRef: originalRef.trim(),
        reviewer: reviewer.trim(),
        assertedMeaning: assertedMeaning.trim(),
        limitations: sv
          ? "Operatörens egen observation utan myndighetsbekräftelse."
          : "Operator observation without authority confirmation.",
        environment: selectedEnvironment,
      };
    }

    return {
      kind: "local_prepared_artifact",
      owner: artifactOwner(owner),
      artifactId: artifactId.trim(),
      revision: revision.trim(),
      digest: digest.trim(),
      environment: selectedEnvironment,
    };
  }

  return (
    <Box display="grid" gap="sm">
      <Text>
        {sv
          ? "Länka verifierat underlag. Referensen kontrolleras mot ägandets egen sparade post och är inte ett fritt textfält."
          : "Link verified evidence. The reference is checked against its owner's retained record and is not a free-text field."}
      </Text>
      {obligation.fulfillment && (
        <Text>
          {obligation.fulfillment.verification} — {obligation.fulfillment.reason} (
          {new Date(obligation.fulfillment.recordedAt).toLocaleString(locale)})
        </Text>
      )}
      <SelectInput
        label={sv ? "Referenstyp" : "Reference type"}
        value={kind}
        options={[...kinds]}
        onSelect={(value) => setKind(Schema.decodeUnknownSync(Schema.Literals(kinds))(value))}
      />
      {kind === "artifact" && (
        <SelectInput
          label={sv ? "Artefaktägare" : "Artifact owner"}
          value={owner}
          options={[...artifactOwners]}
          onSelect={setOwner}
        />
      )}
      {kind === "artifact" && (
        <InputField
          label={sv ? "Artefakt-ID" : "Artifact ID"}
          value={artifactId}
          onChange={(event) => setArtifactId(event.target.value)}
        />
      )}
      {kind === "artifact" && (
        <InputField
          label={sv ? "Revision" : "Revision"}
          value={revision}
          onChange={(event) => setRevision(event.target.value)}
        />
      )}
      {kind === "attempt" && (
        <InputField
          label={sv ? "Leveransförsök" : "Dispatch attempt ID"}
          value={attemptId}
          onChange={(event) => setAttemptId(event.target.value)}
        />
      )}
      {kind === "external" && (
        <InputField
          label={sv ? "Tidigare länk" : "Earlier link ID"}
          value={originalRef}
          onChange={(event) => setOriginalRef(event.target.value)}
        />
      )}
      {kind === "external" && (
        <InputField
          label={sv ? "Granskare" : "Reviewer actor"}
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
        />
      )}
      {kind === "external" && (
        <InputField
          label={sv ? "Påstådd betydelse" : "Asserted meaning"}
          value={assertedMeaning}
          onChange={(event) => setAssertedMeaning(event.target.value)}
        />
      )}
      {kind !== "external" && (
        <InputField
          label={sv ? "Sparad sha256" : "Retained sha256"}
          value={digest}
          onChange={(event) => setDigest(event.target.value)}
        />
      )}
      <SelectInput
        label={sv ? "Miljö" : "Environment"}
        value={target}
        options={[...environments]}
        onSelect={setTarget}
      />
      <Button type="button" disabled={link.isPending} onClick={() => link.mutate()}>
        {sv ? "Länka underlag" : "Link evidence"}
      </Button>
    </Box>
  );
}
