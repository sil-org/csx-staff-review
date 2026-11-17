// Fiscal year starts October 1 and is named for the year it ends in:
// FY2027 = Oct 2026 - Sep 2027.
export function fiscalYearOf(date = new Date()) {
  return date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear()
}

export function fiscalYearLabel(fy) {
  return `FY${fy} (Oct ${fy - 1} – Sep ${fy})`
}

export function currentPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}
