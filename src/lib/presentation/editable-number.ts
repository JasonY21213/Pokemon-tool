export function editableInteger(raw: string, minimum: number, maximum: number): number | null {
  const normalized = raw.trim()
  if (!/^-?\d+$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null
}

export function normalizeEditableInteger(raw: string, minimum: number, maximum: number, fallback: number): number {
  const normalized = raw.trim()
  if (!/^-?\d+$/.test(normalized)) return fallback
  const value = Number(normalized)
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}
