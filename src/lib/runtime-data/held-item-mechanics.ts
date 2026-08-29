import type { RuntimeItem, RuntimeItemMechanicsEffect } from './types.ts'

export type AppliedItemEffect = { itemId: string; effect: RuntimeItemMechanicsEffect }

export function supportedItemEffects(item: RuntimeItem | null | undefined): RuntimeItemMechanicsEffect[] {
  return item?.mechanics.status === 'supported' ? item.mechanics.effects : []
}

export function applyItemFixedPointModifier(value: number, numerator: number, denominator: number): number {
  const modifier = Math.floor((numerator * 4096) / denominator)
  return Math.floor((value * modifier + 2047) / 4096)
}

export function itemEffect<K extends RuntimeItemMechanicsEffect['kind']>(
  item: RuntimeItem | null | undefined,
  kind: K,
): Extract<RuntimeItemMechanicsEffect, { kind: K }> | undefined {
  return supportedItemEffects(item).find((effect): effect is Extract<RuntimeItemMechanicsEffect, { kind: K }> => effect.kind === kind)
}
