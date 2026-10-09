# pdfcn source

Adapted from [shadcn-labs/pdfcn](https://github.com/shadcn-labs/pdfcn), revision `39c75c1abbbad7b89ad1d8d3ea740ef635818a4b`. The upstream MIT notice is retained verbatim in [LICENSE](LICENSE).

The source paths at that revision are:

- `apps/web/registry/bases/takumi/lib/pdf-primitives.tsx`
- `apps/web/registry/bases/takumi/components/text/text.tsx`
- `apps/web/registry/bases/takumi/components/section/section.tsx`
- `apps/web/registry/bases/takumi/components/page-header/page-header.tsx`
- `apps/web/registry/bases/takumi/components/page-footer/page-footer.tsx`
- `apps/web/registry/bases/takumi/components/key-value/key-value.tsx`
- `apps/web/registry/bases/takumi/components/table/table.tsx` and `table.styles.ts`
- `apps/web/registry/bases/takumi/blocks/invoice-minimal/invoice-minimal.tsx`

The local adaptation retains the React composition, point-to-CSS conversion, row keep-together behavior, table header propagation and document components. It narrows visual variants to the ones used by Drastic, uses typed React CSS properties and a fixed local theme, and forwards `Section.noWrap` into the primitive. There is no mutable theme provider. Takumi's actual page counters replace the sample's fixed page text; page geometry belongs to the render options, so no fixed A4 content height or sticky footer enters the flowing document.

The application-owned invoice and credit renderers compose these components with immutable issued facts. Sample data, amount arithmetic, dollar formatting, remote assets and font defaults are replaced by retained exact minor-unit strings, Swedish wording and bundled qualified fonts. Accounting calculations remain with their existing owners.

Body row rules belong to the following row, while the table header retains its bottom rule. This leaves the last row on each page without a trailing separator. The credit explanation occupies a named note before the totals; the credited amount closes the summary.

PDF styles describe the Takumi output document, separately from the browser interface's StyleX components and tokens. New product PDF layouts use this adapter and their owning application workflow.
