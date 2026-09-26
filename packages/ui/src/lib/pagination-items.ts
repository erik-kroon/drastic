type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

function getPaginationItems(page: number, pageCount: number, siblings = 1): PaginationItem[] {
  if (pageCount <= 0) return [];
  const selected = new Set([1, pageCount]);

  for (
    let item = Math.max(1, page - siblings);
    item <= Math.min(pageCount, page + siblings);
    item += 1
  )
    selected.add(item);
  const pages = [...selected].sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  pages.forEach((item, index) => {
    const previous = pages[index - 1];

    if (previous && item - previous > 1)
      result.push(index === 1 ? "ellipsis-start" : "ellipsis-end");
    result.push(item);
  });

  return result;
}

export { getPaginationItems };

export type { PaginationItem };
