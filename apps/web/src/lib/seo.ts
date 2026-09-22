type SeoOptions = {
  title: string;
  description: string;
  keywords?: string;
  image?: string;
};

export function seo({ title, description, keywords, image }: SeoOptions) {
  return [
    { title },
    { name: "description", content: description },
    ...(keywords ? [{ name: "keywords", content: keywords }] : []),
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    {
      name: "twitter:card",
      content: image ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(image
      ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
}
