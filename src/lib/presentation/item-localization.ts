import type { RuntimeItem, RuntimeItemLocalization } from '../runtime-data/types.ts'

export function itemName(item: RuntimeItem | undefined, localizations: RuntimeItemLocalization[]): string {
  if (!item) return '暂无道具'
  return localizations.find(localization => localization.itemId === item.itemId)?.zhHansName ?? item.canonicalName
}

export function itemSearchLabel(item: RuntimeItem, localizations: RuntimeItemLocalization[]): string {
  const localized = itemName(item, localizations)
  return localized === item.canonicalName ? localized : `${localized}（${item.canonicalName}）`
}
