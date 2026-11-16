export function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function nowIso() {
  return new Date().toISOString();
}

export function daysAgo(days, from = new Date()) {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

export function hoursAgo(hours, from = new Date()) {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

export function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);

  if (next.getDate() < day) {
    next.setDate(0);
  }

  return next;
}

export function startOfDay(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function monthKey(date) {
  const value = new Date(date);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

export function monthLabel(date) {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function isFuture(value) {
  return new Date(value).getTime() > Date.now();
}

export function isPast(value) {
  return new Date(value).getTime() <= Date.now();
}

export function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return Math.floor((endDate - startDate) / (24 * 60 * 60 * 1000));
}

export function lastNDays(count, from = new Date()) {
  const days = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = startOfDay(daysAgo(index, from));
    days.push({
      date,
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    });
  }

  return days;
}
