/**
 * Pure helpers for cage-to-cage fish transfers (no Convex deps).
 */

export function deriveTransferType(
  quantity: number,
  sourceCurrentCount: number,
): 'full' | 'partial' {
  return quantity >= sourceCurrentCount ? 'full' : 'partial'
}

export function transferBiomassKg(quantity: number, abwGrams: number): number {
  return (quantity * abwGrams) / 1000
}

export function classifyDestination(
  destStatus: string,
  allowEmptyStatuses: string[],
): 'stock' | 'topup' | 'invalid' {
  if (allowEmptyStatuses.includes(destStatus)) return 'stock'
  if (destStatus === 'active') return 'topup'
  return 'invalid'
}

export function sourceCagePatchAfterTransfer(opts: {
  transferType: 'full' | 'partial'
  quantity: number
  sourceCurrentCount: number
  now: number
}): Record<string, unknown> {
  const { transferType, quantity, sourceCurrentCount, now } = opts
  if (transferType === 'full') {
    // Status empty is what restocking rules check; counts must be zero.
    return {
      currentCount: 0,
      status: 'empty',
      updatedAt: now,
    }
  }
  return {
    currentCount: sourceCurrentCount - quantity,
    status: 'active',
    updatedAt: now,
  }
}
