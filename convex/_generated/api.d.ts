/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as biweeklyRecords from "../biweeklyRecords.js";
import type * as cages from "../cages.js";
import type * as companies from "../companies.js";
import type * as crons from "../crons.js";
import type * as dailyRecords from "../dailyRecords.js";
import type * as expenses from "../expenses.js";
import type * as farmLocations from "../farmLocations.js";
import type * as feed from "../feed.js";
import type * as fishTransfers from "../fishTransfers.js";
import type * as harvest from "../harvest.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as idempotency from "../idempotency.js";
import type * as inventory from "../inventory.js";
import type * as inventoryItems from "../inventoryItems.js";
import type * as lib_authErrors from "../lib/authErrors.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_cycles from "../lib/cycles.js";
import type * as lib_farmRules from "../lib/farmRules.js";
import type * as lib_feedLedger from "../lib/feedLedger.js";
import type * as lib_fishTransferLogic from "../lib/fishTransferLogic.js";
import type * as lib_growth from "../lib/growth.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as messaging_channels from "../messaging/channels.js";
import type * as messaging_deliver from "../messaging/deliver.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as procurement from "../procurement.js";
import type * as productionBackfill from "../productionBackfill.js";
import type * as reconciliation from "../reconciliation.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as seed from "../seed.js";
import type * as stocking from "../stocking.js";
import type * as userAccounts from "../userAccounts.js";
import type * as mfa from "../mfa.js";
import type * as phoneAuth from "../phoneAuth.js";
import type * as security from "../security.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  auth: typeof auth;
  biweeklyRecords: typeof biweeklyRecords;
  cages: typeof cages;
  companies: typeof companies;
  crons: typeof crons;
  dailyRecords: typeof dailyRecords;
  expenses: typeof expenses;
  farmLocations: typeof farmLocations;
  feed: typeof feed;
  fishTransfers: typeof fishTransfers;
  harvest: typeof harvest;
  health: typeof health;
  http: typeof http;
  idempotency: typeof idempotency;
  inventory: typeof inventory;
  inventoryItems: typeof inventoryItems;
  "lib/authErrors": typeof lib_authErrors;
  "lib/authz": typeof lib_authz;
  "lib/cycles": typeof lib_cycles;
  "lib/farmRules": typeof lib_farmRules;
  "lib/feedLedger": typeof lib_feedLedger;
  "lib/fishTransferLogic": typeof lib_fishTransferLogic;
  "lib/growth": typeof lib_growth;
  "lib/tenancy": typeof lib_tenancy;
  "messaging/channels": typeof messaging_channels;
  "messaging/deliver": typeof messaging_deliver;
  migrations: typeof migrations;
  notifications: typeof notifications;
  procurement: typeof procurement;
  productionBackfill: typeof productionBackfill;
  reconciliation: typeof reconciliation;
  reminders: typeof reminders;
  reports: typeof reports;
  sales: typeof sales;
  seed: typeof seed;
  stocking: typeof stocking;
  userAccounts: typeof userAccounts;
  mfa: typeof mfa;
  phoneAuth: typeof phoneAuth;
  security: typeof security;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
