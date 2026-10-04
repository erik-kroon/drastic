export const chart = [
  { id: "account_bank", code: "1930", name: "Företagskonto" },
  { id: "account_clearing", code: "2890", name: "Övriga kortfristiga skulder" },
  { id: "account_ar", code: "1510", name: "Kundfordringar" },
  { id: "account_ap", code: "2440", name: "Leverantörsskulder" },
  { id: "account_vat", code: "2650", name: "Momsredovisning" },
  { id: "account_tax", code: "1630", name: "Skattekonto" },
  { id: "account_assets", code: "1210", name: "Tillgångar" },
  { id: "account_equity", code: "2099", name: "Eget kapital och resultat" },
  { id: "account_expense", code: "6540", name: "IT-tjänster" },
];

export const august = {
  1930: 16421841n,
  2999: -245000n,
  1510: 4250000n,
  2440: -2893000n,
  2650: -1428100n,
  1630: 1149200n,
  1210: 39561877n,
  2099: -56816818n,
  6540: 0n,
};

export const september = {
  1930: 19120000n,
  2999: -341000n,
  1510: 6245000n,
  2440: -3899000n,
  2650: -1428100n,
  1630: 1149200n,
  1210: 39561877n,
  2099: -61997977n,
  6540: 1590000n,
};

export function decimal(value) {
  const magnitude = value < 0n ? -value : value;

  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}`;
}

function voucher(number, date, title, lines) {
  return { number, date, title, lines };
}

const movement = (amount) => [
  ["2999", amount],
  ["1930", -amount],
];

const detail = (amount) => [
  ["6540", -amount],
  ["1930", amount],
];

const rows = [
  voucher(12, "20260114", "Preliminär skatt", movement(-425000n)),
  voucher(58, "20260228", "Interimskonto", movement(180000n)),
  voucher(141, "20260929", "Reglering mellanskuld", movement(-96000n)),
  voucher(
    142,
    "20260929",
    "Synthetic mapping detail",
    Array.from({ length: 35 }, () => movement(-100n)).flat(),
  ),
  voucher(
    143,
    "20260929",
    "Synthetic mapping detail",
    Array.from({ length: 35 }, () => movement(100n)).flat(),
  ),
];

export const invoiceInventory = [
  {
    kind: "sales_open_items",
    category: "sales",
    code: "1510",
    direction: "customer",
    items: [
      ["F-2026-0038", 1875000n, "Björkdalen Skogsförvaltning AB", false],
      ["F-2026-0041", 1620000n, "Fjällgården Fjällhotell & Konferens AB", false],
      ["F-2026-0042", 1500000n, "Lindqvist Bygg & Entreprenad AB", false],
      ["F-2026-0034", 1250000n, "Fjällgården Fjällhotell & Konferens AB", false],
      ["F-2026-0032", 1000000n, "Lindqvist Bygg & Entreprenad AB", true],
      ["F-2026-0033", 2000000n, "Björkdalen Skogsförvaltning AB", true],
      ...Array.from({ length: 28 }, (_, index) => [
        `synthetic-customer-paid-${index + 1}`,
        10000n,
        `Synthetic customer ${index + 1}`,
        true,
      ]),
    ],
  },
  {
    kind: "purchase_open_items",
    category: "purchases",
    code: "2440",
    direction: "supplier",
    items: [
      ["1048", -1875000n, "Nordhamn Studio AB", false],
      ["882", -480000n, "Vinter & Co AB", false],
      ["hyra", -1544000n, "Fjällby Fastigheter AB", false],
      ["Hyra", -350000n, "Fjällby Fastigheter AB", true],
      ["Kontor", -98000n, "Kontorsbolaget AB", true],
      ["Telia", -90000n, "Telia Sverige AB", true],
      ...Array.from({ length: 77 }, (_, index) => [
        `synthetic-supplier-paid-${index + 1}`,
        -10000n,
        `Synthetic supplier ${index + 1}`,
        true,
      ]),
    ],
  },
];

export const assetInventory = Array.from({ length: 4 }, (_, index) => ({
  identity: `asset-${index + 1}`,
  cost: index < 3 ? 15000000n : 10000000n,
  accumulated: index < 3 ? 5000000n : 438123n,
}));

const reserved = new Set([1, 12, 58, 141, 142, 143, 398, 412, 425, 428]);

let nextNumber = 2;

function nextIdentity() {
  while (reserved.has(nextNumber)) nextNumber++;

  return nextNumber++;
}

for (const inventory of invoiceInventory)
  for (const [identity, amount, name, paid] of inventory.items) {
    if (typeof amount !== "bigint") throw new Error("Invoice amounts must be exact minor units.");

    const augustItem = [
      "F-2026-0032",
      "F-2026-0033",
      "F-2026-0034",
      "1048",
      "882",
      "Hyra",
      "Kontor",
      "Telia",
    ].includes(identity);

    const date = augustItem ? "20260810" : paid ? "20260501" : "20260910";

    const due = { 20260810: "2026-09-09", 20260501: "2026-05-31" }[date] ?? "2026-10-10";

    rows.push(
      voucher(nextIdentity(), date, `Faktura ${identity}, ${name}, förfallodag ${due}`, [
        [inventory.code, amount],
        ["2099", -amount],
      ]),
    );

    if (paid)
      rows.push(
        voucher(nextIdentity(), augustItem ? "20260915" : "20260605", `Betalning ${identity}`, [
          ["1930", amount],
          [inventory.code, -amount],
        ]),
      );
  }

for (const asset of assetInventory)
  rows.push(
    voucher(nextIdentity(), "20260831", `Ingående tillgång ${asset.identity}`, [
      ["1210", asset.cost],
      ["1210", -asset.accumulated],
      ["2099", -(asset.cost - asset.accumulated)],
    ]),
  );

for (let number = 2; number < 428; number++) {
  if (rows.some((row) => row.number === number)) continue;

  if (number === 398) rows.push(voucher(number, "20260908", "Resa", detail(-235000n)));
  else if (number === 412) rows.push(voucher(number, "20260919", "Licens", detail(-480000n)));
  else if (number === 425)
    rows.push(voucher(number, "20260928", "Utbetalning, ej avstämd", detail(-875000n)));
  else
    rows.push(
      voucher(number, "20260830", "Synthetic retained historical transaction", [
        ["1210", number % 2 ? 1n : -1n],
        ["2099", number % 2 ? -1n : 1n],
      ]),
    );
}

function balance(asOf) {
  const sums = Object.fromEntries(Object.keys(august).map((code) => [code, 0n]));

  for (const row of rows.filter((entry) => entry.date <= asOf))
    for (const [code, amount] of row.lines) sums[code] += amount;

  return sums;
}

const before = balance("20260831");

rows.push(
  voucher(
    1,
    "20260831",
    "Independent opening control point",
    Object.entries(august)
      .map(([code, amount]) => [code, amount - before[code]])
      .filter(([, amount]) => amount !== 0n),
  ),
);

const after = balance("20260930");

rows.push(
  voucher(
    428,
    "20260930",
    "Independent September control point",
    Object.entries(september)
      .map(([code, amount]) => [code, amount - after[code]])
      .filter(([, amount]) => amount !== 0n),
  ),
);

if (
  rows.length !== 428 ||
  new Set(rows.map((row) => row.number)).size !== 428 ||
  rows.some((row) => row.lines.reduce((total, [, amount]) => total + amount, 0n) !== 0n)
)
  throw new Error("The independent 428-voucher fixture must balance.");

export const mappings = chart.map((account) => ({
  sourceAccount: account.code === "2890" ? "2999" : account.code,
  accountId: account.id,
}));

export const content =
  "#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n" +
  chart
    .map((account) => {
      const code = account.code === "2890" ? "2999" : account.code;

      return `#KONTO ${code} "${account.name}"\n#IB 0 ${code} 0.00\n#UB 0 ${code} ${decimal(september[code])}\n`;
    })
    .join("") +
  rows
    .map(
      (row) =>
        `#VER A ${row.number} ${row.date} "${row.title}"\n{\n${row.lines.map(([code, amount]) => `#TRANS ${code} {} ${decimal(amount)}\n`).join("")}\n}\n`,
    )
    .join("");

export const openingCustomers = [
  ["F-2026-0032", "1000000", "Lindqvist Bygg & Entreprenad AB"],
  ["F-2026-0033", "2000000", "Björkdalen Skogsförvaltning AB"],
  ["F-2026-0034", "1250000", "Fjällgården Fjällhotell & Konferens AB"],
];

export const openingSuppliers = [
  ["1048", "-1875000", "Nordhamn Studio AB"],
  ["882", "-480000", "Vinter & Co AB"],
  ["Hyra", "-350000", "Fjällby Fastigheter AB"],
  ["Kontor", "-98000", "Kontorsbolaget AB"],
  ["Telia", "-90000", "Telia Sverige AB"],
];

export const finalBalances = {
  ...september,
  1930: september["1930"] + 773000n,
  1510: september["1510"] - 1250000n,
  6540: september["6540"] + 477000n,
};

const finalRows = rows.map((row) => {
  if (row.number === 398) return { ...row, title: "Resa, konferens" };

  if (row.number === 412) return { ...row, title: "Programvarulicens" };

  return row;
});

finalRows.push(
  voucher(429, "20260929", "Kontorsinköp", detail(-119000n)),
  voucher(430, "20260930", "Betalning F-2026-0034", [
    ["1930", 1250000n],
    ["1510", -1250000n],
  ]),
  voucher(431, "20260930", "Kontorsinköp", detail(-89000n)),
  voucher(432, "20260930", "Kontorsinköp", detail(-134000n)),
  voucher(433, "20260930", "Telia", detail(-64000n)),
  voucher(434, "20260930", "Telia", detail(-71000n)),
);

if (
  finalRows.length !== 434 ||
  finalRows.some(
    (row) =>
      row.date > "20260930" || row.lines.reduce((sum, [, amount]) => sum + amount, 0n) !== 0n,
  )
)
  throw new Error("Final history must balance before native authority.");

export const finalContent =
  "#FLAGGA 0\n#FORMAT UTF8\n#SIETYP 4\n#RAR 0 20260101 20261231\n" +
  chart
    .map((account) => {
      const code = account.code === "2890" ? "2999" : account.code;

      return `#KONTO ${code} "${account.name}"\n#IB 0 ${code} 0.00\n#UB 0 ${code} ${decimal(finalBalances[code])}\n`;
    })
    .join("") +
  finalRows
    .map(
      (row) =>
        `#VER A ${row.number} ${row.date} "${row.title}"\n{\n${row.lines.map(([code, amount]) => `#TRANS ${code} {} ${decimal(amount)}\n`).join("")}\n}\n`,
    )
    .join("");
