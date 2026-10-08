import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { SourceHighlight, type SourceRegion } from "./source-highlight";

const styles = stylex.create({
  frame: {
    width: "100%",
    minHeight: 640,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.muted,
  },
  image: {
    display: "block",
    maxWidth: "100%",
    maxHeight: 800,
    objectFit: "contain",
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: tokens.imageOutline,
    borderRadius: tokens.radiusMd,
  },
  imageFrame: { position: "relative", width: "fit-content", maxWidth: "100%" },
  text: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightNormal,
    padding: tokens.space6,
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusMd,
  },
  archive: {
    height: tokens.archivePreviewHeight,
    minHeight: tokens.archivePreviewHeight,
    maxHeight: tokens.archivePreviewHeight,
  },
  compact: {
    width: "100%",
    height: tokens.sourcePreviewHeight,
    minHeight: tokens.sourcePreviewHeight,
    maxHeight: tokens.sourcePreviewHeight,
    overflowY: "auto",
    backgroundColor: tokens.sidebar,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
  },
});

export function DocumentPreview({
  content,
  mediaType,
  filename,
  compact = false,
  archive = false,
  highlight,
}: {
  content: string;
  mediaType: string;
  filename: string;
  compact?: boolean;
  archive?: boolean;
  highlight?: { readonly region: SourceRegion; readonly quote: string; readonly label: string };
}) {
  const [url, setUrl] = useState("");
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [content, mediaType]);

  if (!url) return null;

  if (mediaType === "application/pdf")
    return (
      <iframe
        title={filename}
        src={url}
        {...stylex.props(
          styles.frame,
          (compact || archive) && styles.compact,
          archive && styles.archive,
        )}
      />
    );

  if (mediaType === "image/png" || mediaType === "image/jpeg")
    return (
      <div {...stylex.props(styles.imageFrame)}>
        <img
          src={url}
          alt={filename}
          onLoad={(event) =>
            setImage({
              url,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          {...stylex.props(
            styles.image,
            (compact || archive) && styles.compact,
            archive && styles.archive,
          )}
        />
        {highlight && image?.url === url ? (
          <SourceHighlight
            region={highlight.region}
            label={`${highlight.label}: ${highlight.quote}`}
            width={image.width}
            height={image.height}
          />
        ) : null}
      </div>
    );

  if (
    !mediaType.startsWith("text/") &&
    mediaType !== "application/json" &&
    mediaType !== "application/xml"
  )
    return null;

  const text = new TextDecoder().decode(
    Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
  );

  return (
    <pre
      {...stylex.props(
        styles.text,
        (compact || archive) && styles.compact,
        archive && styles.archive,
      )}
    >
      {text}
    </pre>
  );
}

export function HtmlDocumentPreview({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      {...stylex.props(styles.frame)}
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  );
}
