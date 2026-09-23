import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
const styles = stylex.create({
  frame: {
    width: "100%",
    minHeight: 640,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.muted,
  },
  image: {
    maxWidth: "100%",
    maxHeight: 800,
    objectFit: "contain",
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: tokens.imageOutline,
    borderRadius: tokens.radiusMd,
  },
  text: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: tokens.fontSizeSm,
    lineHeight: tokens.lineHeightNormal,
    padding: tokens.space6,
    backgroundColor: tokens.muted,
    borderRadius: tokens.radiusMd,
  },
});
export function DocumentPreview({
  content,
  mediaType,
  filename,
}: {
  content: string;
  mediaType: string;
  filename: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const bytes = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content, mediaType]);
  if (!url) return null;
  if (mediaType === "application/pdf")
    return <iframe title={filename} src={url} {...stylex.props(styles.frame)} />;
  if (mediaType === "image/png" || mediaType === "image/jpeg")
    return <img src={url} alt={filename} {...stylex.props(styles.image)} />;
  if (
    !mediaType.startsWith("text/") &&
    mediaType !== "application/json" &&
    mediaType !== "application/xml"
  )
    return null;
  const text = new TextDecoder().decode(
    Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
  );
  return <pre {...stylex.props(styles.text)}>{text}</pre>;
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
