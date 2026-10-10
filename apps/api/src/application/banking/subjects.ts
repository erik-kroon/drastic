export function bankRowSubjects(
  legs: ReadonlyArray<{ readonly statementId: string; readonly rowOrdinal: number }>,
  revision: string,
) {
  return [
    ...new Map(
      legs.map((leg) => [
        `${leg.statementId}:${leg.rowOrdinal}`,
        {
          kind: "bank_row" as const,
          statementId: leg.statementId,
          rowOrdinal: leg.rowOrdinal,
          revision,
        },
      ]),
    ).values(),
  ];
}
