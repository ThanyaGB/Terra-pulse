/** Masked-phone convention used everywhere in the UI: 98721-XXXXX */
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length < 10) return 'XXXXX-XXXXX';
  return `${local.slice(0, 5)}-XXXXX`;
}
