import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import type * as Review from "@open-erp/contracts/accountant-review";
import * as Sie from "@open-erp/contracts/sie";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { sieCopy } from "./sie-copy";

export function SiePanel({
  book,
  pack,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  pack: typeof Review.ReviewPack.Type;
  locale: Locale;
}) {
  const copy = sieCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const [after, setAfter] = useState("");
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const firstCursor = useRef({ version: 0, value: "" });
  const path = `${bookPath(book)}/sie-transfers`;

  const prepare = useMutation({
    mutationFn: (input: typeof Sie.PrepareSie.Type) =>
      readAccounting(path, Sie.SieView, mutationOptions(path, JSON.stringify(input), keys.current)),
    onSuccess: async (view) => {
      if (
        view.capture.scope.bookId !== book.id ||
        view.capture.scope.entityId !== book.entityId ||
        view.capture.input.packId !== pack.id ||
        view.capture.input.packDigest !== pack.digest
      )
        throw new Error("SIE capture scope mismatch");
      setId(view.capture.id);
      await queryClient.invalidateQueries({ queryKey: [...bookKey(book), "sie-list"] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [...bookKey(book), "sie-list"] });
    },
  });

  const list = useQuery({
    queryKey: [...bookKey(book), "sie-list", inventoryVersion, after],
    queryFn: async ({ signal }) => {
      const retainedFirst = queryClient.getQueryData<typeof Sie.SieList.Type>([
        ...bookKey(book),
        "sie-list",
        inventoryVersion,
        "",
      ])?.first;

      const cursor =
        after ||
        (firstCursor.current.version === inventoryVersion ? firstCursor.current.value : "") ||
        retainedFirst ||
        "";

      const result = await readAccounting(
        `${path}${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        Sie.SieList,
        { signal },
      );

      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("SIE inventory scope mismatch");

      if (firstCursor.current.version === inventoryVersion && !firstCursor.current.value)
        firstCursor.current.value = result.first;

      return result;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  return (
    <details>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
        <Text>{copy.warning}</Text>
        <Text>{copy.selection}</Text>
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);

            const decoded = Schema.decodeUnknownOption(Sie.PrepareSie)({
              packId: pack.id,
              packDigest: pack.digest,
              selection: "all_pack_movement_vouchers",
              legalName: values.get("sieLegalName"),
              legalNameEvidenceId: values.get("sieEvidence"),
            });

            if (decoded._tag === "None") {
              setError(copy.invalid);

              return;
            }

            setError("");
            prepare.mutate(decoded.value);
          }}
        >
          <InputField
            name="sieLegalName"
            label={copy.legalName}
            required
            maxLength={2000}
            disabled={prepare.isPending}
          />
          <InputField
            name="sieEvidence"
            label={copy.evidence}
            required
            disabled={prepare.isPending}
          />
          <Text>{copy.retry}</Text>
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button type="submit" size="xl" disabled={prepare.isPending}>
              {copy.prepare}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xl"
              disabled={prepare.isPending}
              onClick={() => {
                keys.current.clear();
                prepare.reset();
              }}
            >
              {copy.another}
            </Button>
          </Box>
          <Text role="status">{error}</Text>
          <AccountingStatus
            write
            locale={locale}
            pending={prepare.isPending}
            error={prepare.error}
          />
        </Box>
        <details>
          <summary>{copy.retained}</summary>
          <Box display="grid" gap="md" paddingBlock="md">
            <Text>{copy.inventoryNote}</Text>
            <Box display="flex" flexWrap="wrap" gap="md">
              <Button
                variant="outline"
                size="xl"
                disabled={list.isFetching}
                onClick={() => {
                  const nextVersion = inventoryVersion + 1;
                  // A new explicit inventory must not inherit an older cached first-page cutoff.
                  queryClient.removeQueries({
                    queryKey: [...bookKey(book), "sie-list", nextVersion],
                  });
                  firstCursor.current = { version: nextVersion, value: "" };
                  setAfter("");
                  setInventoryVersion(nextVersion);
                }}
              >
                {copy.refresh}
              </Button>
              <Button
                variant="outline"
                size="xl"
                disabled={!after || !list.isSuccess || after === list.data.first || list.isFetching}
                onClick={() => {
                  if (list.data) setAfter(list.data.first);
                }}
              >
                {copy.first}
              </Button>
              <Button
                variant="outline"
                size="xl"
                disabled={!list.isSuccess || !list.data.next || list.isFetching}
                onClick={() => {
                  if (list.data?.next) setAfter(list.data.next);
                }}
              >
                {copy.next}
              </Button>
            </Box>
            <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
            {list.isSuccess ? (
              <Text>
                {copy.inventoryCount}: {list.data.total} · {copy.inventoryCutoff}:{" "}
                {list.data.cutoff}
              </Text>
            ) : null}
            {list.isSuccess && list.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
            {list.data?.items.map((item) => (
              <Box key={item.id} display="grid" gap="sm">
                <Text>
                  {item.id} · {item.createdAt}
                </Text>
                <Box>
                  <Button variant="outline" size="xl" onClick={() => setId(item.id)}>
                    {copy.inspect}
                  </Button>
                </Box>
              </Box>
            ))}
          </Box>
        </details>
        {id ? <SieInspector key={`${book.id}:${id}`} book={book} id={id} locale={locale} /> : null}
      </Box>
    </details>
  );
}

function SieInspector({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = sieCopy(locale);
  const queryClient = useQueryClient();
  const path = `${bookPath(book)}/sie-transfers/${encodeURIComponent(id)}`;

  const view = useQuery({
    queryKey: [...bookKey(book), "sie", id],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Sie.SieView, { signal });

      if (
        result.capture.id !== id ||
        result.capture.scope.bookId !== book.id ||
        result.capture.scope.entityId !== book.entityId
      )
        throw new Error("SIE capture scope mismatch");

      return result;
    },
  });

  const resume = useMutation({
    mutationFn: () => readAccounting(`${path}/render`, Sie.SieView, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...bookKey(book), "sie", id] }),
        queryClient.invalidateQueries({ queryKey: [...bookKey(book), "sie-list"] }),
      ]);
    },
  });

  const capture = view.data?.capture;
  const artifact = view.data?.artifact;

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      {capture ? (
        <>
          <Text>
            {copy.pack}: {capture.input.packId}
          </Text>
          <Text>
            {capture.startsOn} – {capture.endsOn} · {capture.currency} · {copy.generatedOn}:{" "}
            {capture.generatedOn}
          </Text>
          <Text>
            {capture.input.legalName} · {copy.evidence}: {capture.input.legalNameEvidenceId}
          </Text>
          <details>
            <summary>{copy.source}</summary>
            <Box display="grid" minWidth="zero">
              <textarea
                aria-label={copy.source}
                value={JSON.stringify(capture, null, 2)}
                readOnly
                rows={12}
                cols={16}
              />
            </Box>
          </details>
          <Text>{artifact ? copy.sealed : copy.captured}</Text>
          {!artifact ? (
            <Box>
              <Button
                variant="outline"
                size="xl"
                disabled={resume.isPending}
                onClick={() => resume.mutate()}
              >
                {copy.resume}
              </Button>
            </Box>
          ) : null}
          <AccountingStatus write locale={locale} pending={resume.isPending} error={resume.error} />
          {artifact ? (
            <SieDownload
              key={artifact.sha256}
              book={book}
              capture={capture}
              artifact={artifact}
              locale={locale}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function SieDownload({
  book,
  capture,
  artifact,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  capture: typeof Sie.SieCapture.Type;
  artifact: typeof Sie.SieArtifact.Type;
  locale: Locale;
}) {
  const copy = sieCopy(locale);

  const download = useMutation({
    mutationFn: async () => {
      if (
        artifact.captureId !== capture.id ||
        artifact.captureDigest !== capture.digest ||
        artifact.packDigest !== capture.input.packDigest ||
        artifact.sourceDigest !== capture.sourceDigest ||
        artifact.scope.bookId !== book.id ||
        artifact.scope.entityId !== book.entityId ||
        artifact.filename !== `${capture.id}.SI` ||
        artifact.byteLength < 1 ||
        artifact.byteLength > 8388608
      )
        throw new Error("SIE artifact identity mismatch");
      const binary = atob(artifact.contentBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const digest = await crypto.subtle.digest("SHA-256", bytes);

      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      if (bytes.length !== artifact.byteLength || hash !== artifact.sha256)
        throw new Error("SIE binary hash or length mismatch");

      return bytes;
    },
  });

  const bytes = download.data;

  return (
    <Box display="grid" gap="sm" minWidth="zero">
      <Text>
        {artifact.filename} · {artifact.byteLength} {copy.bytes}
      </Text>
      <Box display="grid" minWidth="zero">
        <textarea aria-label={copy.hash} value={artifact.sha256} readOnly rows={2} cols={16} />
      </Box>
      <Box>
        <Button
          variant="outline"
          size="xl"
          disabled={download.isPending || Boolean(bytes)}
          onClick={() => download.mutate()}
        >
          {copy.download}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={download.isPending} error={download.error} />
      {bytes ? (
        <>
          <Text role="status">{copy.verified}</Text>
          <a
            download={artifact.filename}
            ref={(anchor) => {
              if (!anchor) return;

              const url = URL.createObjectURL(
                new Blob([bytes], { type: "application/octet-stream" }),
              );

              anchor.href = url;

              return () => URL.revokeObjectURL(url);
            }}
          >
            {copy.save}
          </a>
        </>
      ) : null}
    </Box>
  );
}
