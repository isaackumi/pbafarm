import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Projects: capex and farm improvements (Paper 20). Spread into the schema
 * like botTables. Totals the list and the brief need (spent, progress, next
 * due milestone, over budget) are kept on the project row by the writes in
 * convex/projects.ts, so lists read one row per project and never sum costs
 * or milestones on the fly.
 */
export const projectStatus = v.union(
  v.literal('planned'),
  v.literal('active'),
  v.literal('on_hold'),
  v.literal('done'),
  v.literal('cancelled'),
)

export const projectCategory = v.union(
  v.literal('infrastructure'),
  v.literal('equipment'),
  v.literal('expansion'),
  v.literal('maintenance'),
  v.literal('certification'),
  v.literal('other'),
)

export const projectTables = {
  projects: defineTable({
    companyId: v.id('companies'),
    /** The project's site; none = company-wide (visible to every member). */
    locationId: v.optional(v.id('farmLocations')),
    name: v.string(),
    category: projectCategory,
    ownerUserId: v.id('users'),
    startDate: v.string(),
    targetEndDate: v.string(),
    budget: v.number(),
    currency: v.string(),
    status: projectStatus,
    /** Units the project builds or improves (at most 200). */
    unitIds: v.optional(v.array(v.id('cages'))),
    notes: v.optional(v.string()),
    /** Sum of the project's costs. */
    spent: v.number(),
    /** spent > budget (indexed: the "over budget" exceptions). */
    overBudget: v.boolean(),
    milestonesTotal: v.number(),
    milestonesDone: v.number(),
    /** Mean milestone progress, 0..100 (done = 100); 0 with no milestones. */
    progressPct: v.number(),
    /** Earliest due date of an open milestone. */
    nextDueDate: v.optional(v.string()),
    createdBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_company_and_targetEndDate', ['companyId', 'targetEndDate'])
    .index('by_company_and_status_and_targetEndDate', ['companyId', 'status', 'targetEndDate'])
    .index('by_company_and_locationId_and_targetEndDate', ['companyId', 'locationId', 'targetEndDate'])
    .index('by_company_and_ownerUserId_and_targetEndDate', ['companyId', 'ownerUserId', 'targetEndDate'])
    .index('by_company_and_overBudget', ['companyId', 'overBudget'])
    .searchIndex('search_name', { searchField: 'name', filterFields: ['companyId'] }),

  projectMilestones: defineTable({
    companyId: v.id('companies'),
    projectId: v.id('projects'),
    /** Copied from the project, for site scope on the exceptions list. */
    locationId: v.optional(v.id('farmLocations')),
    title: v.string(),
    dueDate: v.string(),
    progressPct: v.number(),
    /** Set when done (progress 100). */
    doneAt: v.optional(v.number()),
    doneDate: v.optional(v.string()),
    /** Not done: indexed with the due date for "late milestones". */
    open: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_projectId_and_dueDate', ['projectId', 'dueDate'])
    .index('by_company_and_open_and_dueDate', ['companyId', 'open', 'dueDate']),

  /**
   * Money spent on a project. A cost may point at an existing expense or
   * purchase order instead of a typed amount: then its amount is that row's
   * amount (kept in step when the expense is edited or deleted), and one
   * expense or order counts towards at most one project, once.
   */
  projectCosts: defineTable({
    companyId: v.id('companies'),
    projectId: v.id('projects'),
    amount: v.number(),
    date: v.string(),
    note: v.optional(v.string()),
    expenseId: v.optional(v.id('expenses')),
    purchaseOrderId: v.optional(v.id('purchaseOrders')),
    createdBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_projectId_and_date', ['projectId', 'date'])
    .index('by_company_and_expenseId', ['companyId', 'expenseId'])
    .index('by_company_and_purchaseOrderId', ['companyId', 'purchaseOrderId']),
}
