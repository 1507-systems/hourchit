/** Client-facing two-row description for a frozen invoice line. */
export function invoiceLineText(line: {
  description: string;
  detail?: string | null;
  service_date?: string | null;
  charge_code?: string | null;
}): { primary: string; secondary: string | null } {
  const primary = line.service_date
    ? `${line.description} - ${shortDate(line.service_date)}`
    : line.description;
  const secondary = line.detail
    ? line.charge_code
      ? `${line.detail} - ${line.charge_code}`
      : line.detail
    : line.charge_code ?? null;
  return { primary, secondary };
}

function shortDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${Number(match[2])}/${Number(match[3])}`;
}
