const longDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const shortDateFormatter = new Intl.DateTimeFormat('fr-CH', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export function formatDateLabel(dateIso: string, index: number): string {
  const date = parseLocalDate(dateIso);
  const prefix = index === 0 ? "Aujourd'hui — " : index === 1 ? 'Demain — ' : '';
  return `${prefix}${capitalize(longDateFormatter.format(date))}`;
}

export function formatShortDate(dateIso: string): string {
  return capitalize(shortDateFormatter.format(parseLocalDate(dateIso)));
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function hourFromIsoLocalDateTime(value: string): number {
  const match = value.match(/T(\d{2}):/);
  return match ? Number(match[1]) : -1;
}

function parseLocalDate(dateIso: string): Date {
  const [year, month, day] = dateIso.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
