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

// Fiscal quarters follow the fiscal year: Q1 = Oct-Dec, Q2 = Jan-Mar, Q3 = Apr-Jun, Q4 = Jul-Sep.
export function fiscalQuarterOf(date = new Date()) {
  return Math.floor(((date.getMonth() + 3) % 12) / 3) + 1
}
