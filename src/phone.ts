/**
 * An outside number as E.164, so the caller is the same `phone:` identity as in WhatsApp, MAX or a CRM; `null` when
 * the number is too short to be a phone or its country is unknown.
 */
export const e164 = (number: string, region: string | null): string | null => {
  const digits = number.replace(/\D/g, "")
  if (digits.length < 7 || digits.length > 15) return null
  if (/^\s*\+/.test(number)) return `+${digits}`
  if (digits.startsWith("00")) return `+${digits.slice(2)}`
  if (region === "ru" && digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`
  return null
}
