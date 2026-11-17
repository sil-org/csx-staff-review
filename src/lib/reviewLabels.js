export function periodLabel(kind, year, quarter) {
  return kind === 'annual' ? `Annual ${year}` : `Q${quarter} ${year}`
}

const STATUS_LABELS = {
  draft: 'With the employee',
  with_manager: 'With you',
  awaiting_employee: 'Awaiting sign-off',
  locked: 'Signed off',
}

export function statusLabel(status) {
  return STATUS_LABELS[status] || status
}
