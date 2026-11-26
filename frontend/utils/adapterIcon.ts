/** The icon for a network adapter, from its name: Wi-Fi, cellular or wired. */
export function adapterIcon(name: string): string {
  const n = name.toLowerCase();
  if (/wi-?fi|wlan|wireless/.test(n)) return "mdi-wifi";
  if (/cellular|mobile|wwan|lte|5g/.test(n)) return "mdi-signal-cellular-3";
  return "mdi-ethernet";
}
