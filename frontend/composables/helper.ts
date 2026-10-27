import { formatSize, formatSpeed } from "~/utils/localeFormat";

// Written in the UI language: "1.17 MB/s" / "۱٫۱۷ م.ب/ث".
export function useHumanSpeed(speedInBytes: number): string {
  return formatSpeed(speedInBytes);
}

export function useHumanSize(sizeInBytes: number): string {
  return formatSize(sizeInBytes);
}
