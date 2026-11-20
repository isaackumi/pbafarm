/**
 * Action-side wiring of the AI protections (D-023) for the Convex call paths:
 * the org-key gateway, Ask Anowa on the web, the farm bot (text and voice),
 * logbook OCR and weekly reports. The rules are pure (./aiGuard); this file
 * picks targets from the live model lists and gives leases back.
 *
 * Effect stays at the provider edge: `chatAttempt` runs `chatWithUsage`
 * (runChatWithUsage) with the attempt's abort signal, so a passed deadline
 * interrupts the call.
 */
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { chooseModel } from '../llmModels'
import { runChatWithUsage, type ChatReply } from './llmProviders'
import { listedPrice, type Price, type ProviderKind } from './llmModels'
import { breakerKey, type Target } from './aiGuard'

/** A key a call may use: provider, endpoints, the key itself, and whose key it is. */
export type KeySource = {
  providerId: string
  kind: ProviderKind
  /** Where the model list lives (providerBaseUrl). */
  listBaseUrl: string
  /** Where calls go, when different (custom provider's saved URL). */
  callBaseUrl?: string
  apiKey: string
  /** 'server' or the company id: breaker scope and model-cache scope. */
  scope: string
  source: 'org_key' | 'server_key'
}

export type KeyTarget = Target & KeySource & { price?: Price }

/** Models of `source` that may not be picked: open breakers and models already tried. */
function excluded(source: KeySource, blocked: ReadonlySet<string>, tried: ReadonlySet<string> = new Set()): string[] {
  const prefix = `${source.scope}|${source.providerId}|`
  const out: string[] = []
  for (const k of [...blocked, ...tried]) if (k.startsWith(prefix)) out.push(k.slice(prefix.length))
  return out
}

/**
 * First and next targets for `runGuarded`. The first source is the key the
 * gate chose; the others are alternates for an Auto fallback (other server
 * keys). An explicitly requested model is not excluded up front, so the
 * runner can refuse it as paused instead of silently switching.
 */
export function modelPicker(
  ctx: ActionCtx,
  o: {
    sources: KeySource[]
    requested?: string | null
    saved?: string | null
    vision?: boolean
    blocked: ReadonlySet<string>
    explicit: boolean
  },
) {
  // The last model-list problem, so "no target" can say why (unreachable provider, no vision model…).
  let lastError: string | null = null
  const pick = async (source: KeySource, opts: { requested?: string | null; saved?: string | null; exclude: string[] }): Promise<KeyTarget | null> => {
    const { choice, models } = await chooseModel(ctx, {
      target: { providerId: source.providerId, kind: source.kind, baseUrl: source.listBaseUrl, apiKey: source.apiKey },
      scope: source.scope,
      requested: opts.requested,
      saved: opts.saved,
      vision: o.vision,
      exclude: opts.exclude,
    })
    if (!choice.ok) {
      console.warn(`[ai] ${source.providerId}: ${choice.error}`)
      lastError = choice.error
      return null
    }
    return { ...source, model: choice.model, price: listedPrice(models, choice.model) }
  }
  return {
    lastError: () => lastError,
    first: async (): Promise<KeyTarget | null> => {
      const [primary, ...rest] = o.sources
      if (!primary) return null
      const t = await pick(primary, { requested: o.requested, saved: o.saved, exclude: o.explicit ? [] : excluded(primary, o.blocked) })
      if (t || o.explicit) return t
      for (const alt of rest) {
        const a = await pick(alt, { exclude: excluded(alt, o.blocked) })
        if (a) return a
      }
      return null
    },
    next: async (failed: KeyTarget, tried: ReadonlySet<string>): Promise<KeyTarget | null> => {
      const start = Math.max(0, o.sources.findIndex((s) => s.providerId === failed.providerId && s.scope === failed.scope))
      for (const source of o.sources.slice(start)) {
        const t = await pick(source, {
          saved: source === o.sources[0] ? o.saved : null,
          exclude: excluded(source, o.blocked, tried),
        })
        if (t && !tried.has(breakerKey(t.scope, t.providerId, t.model))) return t
      }
      return null
    },
  }
}

/** One chat completion on `t`, interrupted by `signal`. Rejects with the LlmError (message, status). */
export function chatAttempt(o: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; temperature: number; referer?: string }) {
  return async (t: KeyTarget, signal: AbortSignal): Promise<ChatReply> =>
    await runChatWithUsage(
      {
        kind: t.kind,
        providerId: t.providerId,
        baseUrl: t.callBaseUrl ?? t.listBaseUrl,
        apiKey: t.apiKey,
        model: t.model,
        messages: o.messages,
        temperature: o.temperature,
        referer: o.referer,
      },
      undefined,
      { signal },
    )
}

/** Give a lease back; never throws (an expired lease frees itself). */
export async function releaseLease(ctx: ActionCtx, leaseId: Id<'aiLeases'> | null | undefined) {
  if (!leaseId) return
  try {
    await ctx.runMutation(internal.aiGuard.release, { leaseId })
  } catch (err) {
    console.warn('[ai] lease release failed', err instanceof Error ? err.message : err)
  }
}

/** HTTP status of a provider failure, when the error carries one. */
export function statusOf(status: number | null | undefined): number | undefined {
  return typeof status === 'number' ? status : undefined
}
