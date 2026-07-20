export const INTERNET_PING_TARGET_BEST = 'bestPing' as const

export const INTERNET_PING_TARGETS = [
  { id: 'pisgaman', ipv4: '5.202.100.100', ipv6: '' },
  { id: 'zirsakht1', ipv4: '217.218.127.127', ipv6: '' },
  { id: 'zirsakht2', ipv4: '217.218.155.155', ipv6: '' },
  { id: 'google', ipv4: '8.8.8.8', ipv6: '2001:4860:4860::8888' },
  { id: 'cloudflare', ipv4: '1.1.1.1', ipv6: '2606:4700:4700::1111' },
  { id: 'quad9', ipv4: '9.9.9.9', ipv6: '2620:fe::fe' },
  { id: 'opendns', ipv4: '208.67.222.222', ipv6: '2620:119:35::35' },
  { id: 'adguard', ipv4: '94.140.14.14', ipv6: '2a10:50c0::ad1:ad1:ad1:ad1' },
] as const

export type InternetPingPresetId = (typeof INTERNET_PING_TARGETS)[number]['id']
export type InternetPingTargetId = typeof INTERNET_PING_TARGET_BEST | InternetPingPresetId

export const DEFAULT_INTERNET_PING_TARGET: InternetPingTargetId = INTERNET_PING_TARGET_BEST

export function isInternetPingPreset(id: InternetPingTargetId): id is InternetPingPresetId {
  return id !== INTERNET_PING_TARGET_BEST
}

export function internetPingTargetLabel(
  id: InternetPingTargetId,
  t: (key: string) => string,
): string {
  if (id === INTERNET_PING_TARGET_BEST) {
    return t('$vuetify.settings.route.internetPingTarget.presets.bestPing')
  }
  return t(`$vuetify.settings.route.internetPingTarget.presets.${id}`)
}

export function internetPingTargetAddress(id: InternetPingTargetId): string {
  if (!isInternetPingPreset(id)) {
    return ''
  }
  const preset = INTERNET_PING_TARGETS.find((item) => item.id === id)
  if (!preset) {
    return '8.8.8.8'
  }
  if (preset.ipv6) {
    return `${preset.ipv4} / ${preset.ipv6}`
  }
  return preset.ipv4
}
