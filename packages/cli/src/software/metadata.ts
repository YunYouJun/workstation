import type { LocalizedText, SoftwareCatalogItem } from '../../../../software.config'

/** Portable software facts returned by local discovery. */
export interface SoftwareMetadata {
  id: string
  title: LocalizedText
  group: { id: string, title: LocalizedText }
  url: string
  downloadUrl?: string
  repositoryUrl?: string
  iconUrl?: string
  macosIconUrl?: string
  iconStyle?: 'original' | 'rounded'
  iconScale?: number
  description?: string
  installation: { kind: 'download' | 'brew-cask' | 'brew-formula' | 'manual', packageId?: string }
}

export const softwareCatalogSource = { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' } as const

/** Resolve declared package references without interpreting executable recipes. */
export function softwareInstallation(item: SoftwareCatalogItem): SoftwareMetadata['installation'] {
  const packageId = item.cask ?? item.formula
  if (packageId && /^(?:[a-z0-9][a-z0-9._+-]*\/){0,2}[a-z0-9][a-z0-9._+-]*$/.test(packageId))
    return { kind: item.cask ? 'brew-cask' : 'brew-formula', packageId }
  return { kind: item.downloadUrl ? 'download' : 'manual' }
}

/** Select portable fields explicitly; machine paths, commands and preferences stay local. */
export function softwareMetadata(item: SoftwareCatalogItem): SoftwareMetadata {
  return {
    id: item.id,
    title: { ...item.name },
    group: { id: item.groupId, title: { ...item.groupLabel } },
    url: item.url,
    ...(item.downloadUrl ? { downloadUrl: item.downloadUrl } : {}),
    ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
    ...(item.iconUrl || item.favicon ? { iconUrl: item.iconUrl ?? item.favicon } : {}),
    ...(item.macosIconUrl ? { macosIconUrl: item.macosIconUrl } : {}),
    ...(item.iconStyle ? { iconStyle: item.iconStyle } : {}),
    ...(item.iconScale !== undefined ? { iconScale: item.iconScale } : {}),
    ...(item.note ? { description: item.note } : {}),
    installation: softwareInstallation(item),
  }
}
