import { Match } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import * as stylex from "@stylexjs/stylex";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { kanon } from "@open-erp/ui/theme/kanon.stylex";
import { SourceHighlight, type SourceRegion } from "./source-highlight";

export type PdfView = { page: number; zoom: number };

type DocumentState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; document: PDFDocumentProxy };

type PageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; page: number; zoom: number; width: number; height: number; text: string };

const styles = stylex.create({
  bankZoomedViewport: { overflowX: "auto" },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space3,
  },
  viewport: {
    overflow: "auto",
    maxHeight: 640,
    padding: tokens.space3,
    backgroundColor: tokens.reviewCanvas,
    borderRadius: tokens.radiusSm,
    minWidth: 0,
  },
  page: { display: "block", backgroundColor: tokens.card, marginInline: "auto" },
  pageFrame: { position: "relative", marginInline: "auto", width: "fit-content" },
  fitFrame: { maxWidth: "100%" },
  fitPage: { maxWidth: "100%", height: "auto" },
  hidden: { display: "none" },
  dimensions: (width: number, height: number) => ({ width, height }),
  text: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightNormal,
    userSelect: "text",
    margin: 0,
  },
  control: { width: "auto", minWidth: 80 },
  focusedToolbar: {
    minHeight: tokens.controlHeight,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    columnGap: tokens.space4,
  },
  focusedPageControl: { width: "auto", minWidth: 64 },
  focusedZoomControl: { width: "auto", minWidth: 72 },
  focusedTextAction: { marginInlineStart: "auto", color: tokens.primary },
  focusedViewport: { padding: 0, borderRadius: 0 },
  supplierViewport: {
    maxHeight: "none",
    borderRadius: kanon.radiusControl,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: kanon.colorControl,
    outlineOffset: -1,
    boxShadow: kanon.shadowDocument,
  },
  bankViewport: {
    boxSizing: "border-box",
    justifySelf: "center",
    width: 595,
    maxWidth: "100%",
    height: 480,
    maxHeight: 480,
    overflowX: "hidden",
    backgroundColor: tokens.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
  },
  bankTextAction: {
    paddingInline: 0,
    paddingBlock: 0,
    height: tokens.voucherHeaderHeight,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    cursor: "pointer",
  },
  bankToolbar: { minHeight: tokens.voucherHeaderHeight },
  bankHeading: { flexGrow: 1, fontWeight: tokens.fontWeightSemibold },
  bankControl: {
    width: "auto",
    minWidth: 0,
    gap: 2,
    paddingInline: 10,
    fontSize: tokens.fontSizeControl,
    height: tokens.voucherHeaderHeight,
  },
  focusedTextPanel: {
    marginBlockStart: tokens.space4,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "solid",
    borderBlockStartColor: tokens.border,
    paddingBlockStart: tokens.space5,
    fontSize: tokens.fontSizeControl,
    lineHeight: tokens.lineHeight16Px,
    color: tokens.mutedForeground,
  },
  focusedTextSummary: {
    cursor: "pointer",
    listStyle: "none",
    ":focus-visible": { outline: "none", boxShadow: tokens.focusRing },
  },
  focusedText: {
    fontFamily: tokens.fontDocumentText,
    lineHeight: tokens.lineHeight20Px,
    marginBlockStart: tokens.space4,
    color: tokens.foreground,
  },
});

export function PdfViewer(props: {
  content: string;
  workerUrl: string;
  filename: string;
  locale: "sv" | "en";
  view: PdfView;
  onViewChange: (view: PdfView) => void;
  presentation?: "focused" | "bank";
  onAvailabilityChange?: (available: boolean) => void;
  highlight?: { readonly page: number; readonly region: SourceRegion; readonly quote: string };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [documentState, setDocumentState] = useState<DocumentState>({ status: "loading" });
  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [textOpen, setTextOpen] = useState(false);
  const textId = useId();
  const { content, view, workerUrl } = props;
  const sv = props.locale === "sv";
  const focused = props.presentation === "focused" || props.presentation === "bank";

  useEffect(() => {
    let cancelled = false;
    let loading: PDFDocumentLoadingTask | undefined;
    setDocumentState({ status: "loading" });

    async function load() {
      const pdfjs = await import("pdfjs-dist");

      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      loading = pdfjs.getDocument({
        data: Uint8Array.from(atob(content), (character) => character.charCodeAt(0)),
      });
      const document = await loading.promise;

      if (!cancelled) setDocumentState({ status: "ready", document });
    }

    void load().catch(() => {
      if (!cancelled) setDocumentState({ status: "error" });
    });

    return () => {
      cancelled = true;
      void loading?.destroy();
    };
  }, [content, attempt, workerUrl]);

  useEffect(() => {
    let cancelled = false;
    let rendering: RenderTask | undefined;
    setPageState({ status: "loading" });

    async function render() {
      if (documentState.status !== "ready") return;
      const page = await documentState.document.getPage(view.page);

      if (cancelled) return;
      const viewport = page.getViewport({ scale: view.zoom / 100 });
      const target = canvas.current;

      if (!target) return;
      const context = target.getContext("2d");

      if (!context) throw new Error("Canvas unavailable");
      const pixelRatio = window.devicePixelRatio || 1;
      target.width = Math.ceil(viewport.width * pixelRatio);
      target.height = Math.ceil(viewport.height * pixelRatio);
      rendering = page.render({
        canvas: target,
        canvasContext: context,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      const [, text] = await Promise.all([rendering.promise, page.getTextContent()]);

      if (!cancelled)
        setPageState({
          status: "ready",
          page: view.page,
          zoom: view.zoom,
          width: viewport.width,
          height: viewport.height,
          text: text.items.map((item) => ("str" in item ? item.str : "")).join("\n"),
        });
    }

    void render().catch(() => {
      if (!cancelled) setPageState({ status: "error" });
    });

    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [documentState, view.page, view.zoom]);

  const ready =
    documentState.status === "ready" &&
    pageState.status === "ready" &&
    pageState.page === view.page &&
    pageState.zoom === view.zoom;

  const failed = documentState.status === "error" || pageState.status === "error";

  useEffect(() => {
    props.onAvailabilityChange?.(ready);
  }, [props.onAvailabilityChange, ready]);

  return (
    <Box
      display="grid"
      gap={Match.value(props.presentation).pipe(
        Match.when("bank", () => "xl" as const),
        Match.when("focused", () => "sm" as const),
        Match.orElse(() => "md" as const),
      )}
      minWidth="zero"
    >
      <div
        {...stylex.props(
          styles.toolbar,
          focused && styles.focusedToolbar,
          props.presentation === "bank" && styles.bankToolbar,
        )}
      >
        {props.presentation === "bank" ? (
          <span {...stylex.props(styles.bankHeading)}>Original</span>
        ) : null}
        <Box
          as="label"
          display="flex"
          alignItems="center"
          gap={props.presentation === "bank" ? "lg" : "sm"}
        >
          {sv ? "Sida" : "Page"}
          <SelectControl
            aria-label={sv ? "Sida" : "Page"}
            size="compact"
            indicator={focused ? "⌄" : undefined}
            styleX={[
              focused ? styles.focusedPageControl : styles.control,
              props.presentation === "bank" && styles.bankControl,
            ]}
            value={String(view.page)}
            disabled={documentState.status !== "ready"}
            options={
              documentState.status === "ready"
                ? Array.from({ length: documentState.document.numPages }, (_, index) => ({
                    value: String(index + 1),
                    label: sv
                      ? `${index + 1} av ${documentState.document.numPages}`
                      : `${index + 1} of ${documentState.document.numPages}`,
                  }))
                : []
            }
            onValueChange={(value) => {
              if (value !== null) props.onViewChange({ ...view, page: Number(value) });
            }}
          />
        </Box>
        <Box
          as="label"
          display="flex"
          alignItems="center"
          gap={props.presentation === "bank" ? "lg" : "sm"}
        >
          Zoom
          <SelectControl
            aria-label="Zoom"
            size="compact"
            indicator={focused ? "⌄" : undefined}
            styleX={[
              focused ? styles.focusedZoomControl : styles.control,
              props.presentation === "bank" && styles.bankControl,
            ]}
            value={String(view.zoom)}
            options={[50, 75, 100, 125, 150, 200].map((zoom) => ({
              value: String(zoom),
              label: `${zoom} %`,
            }))}
            onValueChange={(value) => {
              if (value !== null) props.onViewChange({ ...view, zoom: Number(value) });
            }}
          />
        </Box>
        {focused ? (
          <Button
            type="button"
            variant={props.presentation === "bank" ? "unstyled" : "ghost"}
            size="sm"
            aria-expanded={textOpen}
            aria-controls={textId}
            styleX={[
              styles.focusedTextAction,
              props.presentation === "bank" && styles.bankTextAction,
            ]}
            onClick={() => setTextOpen(!textOpen)}
          >
            {sv ? "Sidtext" : "Page text"}
          </Button>
        ) : null}
      </div>
      <div
        {...stylex.props(
          styles.viewport,
          focused && styles.focusedViewport,
          props.presentation === "focused" && styles.supplierViewport,
          props.presentation === "bank" && styles.bankViewport,
          props.presentation === "bank" && view.zoom > 100 && styles.bankZoomedViewport,
        )}
      >
        <div {...stylex.props(styles.pageFrame, !focused && view.zoom <= 100 && styles.fitFrame)}>
          <canvas
            ref={canvas}
            role="img"
            aria-label={`${props.filename}, ${sv ? "sida" : "page"} ${view.page}`}
            hidden={!ready}
            {...stylex.props(
              styles.page,
              !ready && styles.hidden,
              pageState.status === "ready" && styles.dimensions(pageState.width, pageState.height),
              !focused && view.zoom <= 100 && styles.fitPage,
            )}
          />
          {ready && props.highlight?.page === view.page ? (
            <SourceHighlight
              region={props.highlight.region}
              label={`${sv ? "Källmarkering" : "Source highlight"}: ${props.highlight.quote}`}
            />
          ) : null}
        </div>
      </div>
      {!ready && !failed ? (
        <PageCaption role="status">{sv ? "Visar sidan…" : "Rendering page…"}</PageCaption>
      ) : null}
      {failed ? (
        <Box display="grid" gap="sm">
          <PageCaption role="alert">
            {sv ? "Sidan kunde inte visas." : "The page could not be rendered."}
          </PageCaption>
          <Box>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {sv ? "Försök visa sidan igen" : "Retry rendering page"}
            </Button>
          </Box>
        </Box>
      ) : null}
      {focused && !textOpen ? null : focused ? (
        <details open={textOpen} {...stylex.props(styles.focusedTextPanel)}>
          <summary
            role="button"
            {...stylex.props(styles.focusedTextSummary)}
            onClick={(event) => {
              event.preventDefault();
              setTextOpen(!textOpen);
            }}
          >
            {textOpen ? "⌄" : "›"} {sv ? "Sidtext" : "Page text"}
          </summary>
          <div id={textId}>
            {ready ? (
              <pre {...stylex.props(styles.text, styles.focusedText)}>{pageState.text}</pre>
            ) : null}
          </div>
        </details>
      ) : (
        <Disclosure title={sv ? "Sidtext" : "Page text"}>
          {ready ? <pre {...stylex.props(styles.text)}>{pageState.text}</pre> : null}
        </Disclosure>
      )}
    </Box>
  );
}
