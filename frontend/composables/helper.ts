export function useHumanSpeed(speedInBytes: number): string {
  if (speedInBytes === 0) return "0 B/s";

  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  const i = Math.floor(Math.log(speedInBytes) / Math.log(1024));
  const humanReadableSpeed = (speedInBytes / Math.pow(1024, i)).toFixed(2);

  return `${humanReadableSpeed} ${units[i]}`;
}

export function useHumanSize(sizeInBytes: number): string {
  if (sizeInBytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(sizeInBytes) / Math.log(1024));
  const humanReadableSize = (sizeInBytes / Math.pow(1024, i)).toFixed(2);

  return `${humanReadableSize} ${units[i]}`;
}