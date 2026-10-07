/** Room codes are four digits. Short entry is padded so 42 and 0042 meet. */
export function normalizeCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (!digits || digits.length > 4) return null
  return digits.padStart(4, '0')
}

export function randomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0')
}

export function cleanName(value) {
  const name = String(value ?? '')
    .replace(/[^\p{L}\p{N} _.'-]/gu, '')
    .trim()
    .slice(0, 16)
  return name || 'Keeper'
}
