import { useEffect, useRef, useState } from "react";
import { DocumentThumbnail } from "@open-erp/ui/components/document-thumbnail";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

type PreviewState = { status: "loading" | "ready" | "error"; width: number; height: number };

export function PdfThumbnail(props: { content: string; filename: string; locale: "sv" | "en" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<PreviewState>({ status: "loading", width: 170, height: 230 });
  const sv = props.locale === "sv";

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};

    setState({ status: "loading", width: 170, height: 230 });

    async function render() {
      const pdfjs = await import("pdfjs-dist");

      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

      const loading = pdfjs.getDocument({
        data: Uint8Array.from(atob(props.content), (character) => character.charCodeAt(0)),
      });

      dispose = () => {
        void loading.destroy();
      };

      const document = await loading.promise;

      if (cancelled) return;
      const page = await document.getPage(1);

      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(170 / original.width, 230 / original.height);
      const viewport = page.getViewport({ scale: scale * 2 });
      const target = canvas.current;

      if (!target) return;
      const context = target.getContext("2d");

      if (!context) throw new Error("Canvas unavailable");
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      const task = page.render({ canvas: target, canvasContext: context, viewport });
      dispose = () => {
        task.cancel();
        void loading.destroy();
      };

      await task.promise;

      if (!cancelled)
        setState({ status: "ready", width: viewport.width / 2, height: viewport.height / 2 });
    }

    void render().catch(() => {
      if (!cancelled) setState({ status: "error", width: 170, height: 230 });
    });

    return () => {
      cancelled = true;
      dispose();
    };
  }, [props.content]);

  return (
    <>
      <DocumentThumbnail
        canvasRef={canvas}
        width={state.width}
        height={state.height}
        label={`${props.filename}, ${sv ? "första sidan" : "first page"}`}
      />
      {state.status === "loading" ? (
        <PageCaption role="status">{sv ? "Begäran pågår…" : "Request pending…"}</PageCaption>
      ) : null}
      {state.status === "error" ? (
        <PageCaption role="alert">
          {sv
            ? "Förhandsvisningen kunde inte läsas. Öppna dokumentet för att hämta originalet."
            : "The preview could not be read. Open the document to download the original."}
        </PageCaption>
      ) : null}
    </>
  );
}
