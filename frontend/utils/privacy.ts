/** Personal data (email, phone, IP, codes) as shown before the user asks to
 * see it: stars that keep only the shape ("***@***", "***.***.***.***"),
 * never a character of the value, so nothing leaks on a stream. */
export function maskSensitive(text: string | null | undefined): string {
  const s = (text ?? "").trim();
  if (!s) return "";
  if (s.includes("@")) return "***@***";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "***.***.***.***";
  if (/^[0-9a-f:]+$/i.test(s) && s.includes(":")) return "****:****:****:****";
  return "******";
}
