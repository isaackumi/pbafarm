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
import type * as batches from "../batches.js";
import type * as biweeklyRecords from "../biweeklyRecords.js";
import type * as cages from "../cages.js";
import type * as companies from "../companies.js";
import type * as crons from "../crons.js";
import type * as dailyRecords from "../dailyRecords.js";
import type * as emailVerification from "../emailVerification.js";
import type * as emails from "../emails.js";
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
import type * as lib_batchNumbers from "../lib/batchNumbers.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_cycles from "../lib/cycles.js";
import type * as lib_effect from "../lib/effect.js";
import type * as lib_effectHttp from "../lib/effectHttp.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_farmRules from "../lib/farmRules.js";
import type * as lib_feedLedger from "../lib/feedLedger.js";
import type * as lib_fishTransferLogic from "../lib/fishTransferLogic.js";
import type * as lib_growth from "../lib/growth.js";
import type * as lib_kpi from "../lib/kpi.js";
import type * as lib_memberships from "../lib/memberships.js";
import type * as lib_orgProfile from "../lib/orgProfile.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_productionEngine from "../lib/productionEngine.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_scope from "../lib/scope.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as memberships from "../memberships.js";
import type * as messaging_channels from "../messaging/channels.js";
import type * as messaging_deliver from "../messaging/deliver.js";
import type * as messaging_policy from "../messaging/policy.js";
import type * as messaging_providers_africastalking from "../messaging/providers/africastalking.js";
import type * as messaging_providers_hubtel from "../messaging/providers/hubtel.js";
import type * as messaging_providers_index from "../messaging/providers/index.js";
import type * as messaging_providers_resend from "../messaging/providers/resend.js";
import type * as messaging_providers_send from "../messaging/providers/send.js";
import type * as messaging_providers_twilio from "../messaging/providers/twilio.js";
import type * as messaging_providers_types from "../messaging/providers/types.js";
import type * as messaging_providers_whatsappCloud from "../messaging/providers/whatsappCloud.js";
import type * as messaging_validators from "../messaging/validators.js";
import type * as mfa from "../mfa.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as phoneAuth from "../phoneAuth.js";
import type * as procurement from "../procurement.js";
import type * as productionBackfill from "../productionBackfill.js";
import type * as reconciliation from "../reconciliation.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as security from "../security.js";
import type * as seed from "../seed.js";
import type * as stocking from "../stocking.js";
import type * as userAccounts from "../userAccounts.js";
import type * as users from "../users.js";
import type * as integrations_apiHttp from "../integrations/apiHttp.js";
import type * as publicApi from "../publicApi.js";
import type * as events from "../events.js";
import type * as apiKeys from "../apiKeys.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  auth: typeof auth;
  batches: typeof batches;
  biweeklyRecords: typeof biweeklyRecords;
  cages: typeof cages;
  companies: typeof companies;
  crons: typeof crons;
  dailyRecords: typeof dailyRecords;
  emailVerification: typeof emailVerification;
  emails: typeof emails;
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
  "lib/batchNumbers": typeof lib_batchNumbers;
  "lib/costing": typeof lib_costing;
  "lib/crypto": typeof lib_crypto;
  "lib/cycles": typeof lib_cycles;
  "lib/effect": typeof lib_effect;
  "lib/effectHttp": typeof lib_effectHttp;
  "lib/email": typeof lib_email;
  "lib/errors": typeof lib_errors;
  "lib/farmRules": typeof lib_farmRules;
  "lib/feedLedger": typeof lib_feedLedger;
  "lib/fishTransferLogic": typeof lib_fishTransferLogic;
  "lib/growth": typeof lib_growth;
  "lib/kpi": typeof lib_kpi;
  "lib/memberships": typeof lib_memberships;
  "lib/orgProfile": typeof lib_orgProfile;
  "lib/phone": typeof lib_phone;
  "lib/productionEngine": typeof lib_productionEngine;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/scope": typeof lib_scope;
  "lib/tenancy": typeof lib_tenancy;
  "lib/tokens": typeof lib_tokens;
  memberships: typeof memberships;
  "messaging/channels": typeof messaging_channels;
  "messaging/deliver": typeof messaging_deliver;
  "messaging/policy": typeof messaging_policy;
  "messaging/providers/africastalking": typeof messaging_providers_africastalking;
  "messaging/providers/hubtel": typeof messaging_providers_hubtel;
  "messaging/providers/index": typeof messaging_providers_index;
  "messaging/providers/resend": typeof messaging_providers_resend;
  "messaging/providers/send": typeof messaging_providers_send;
  "messaging/providers/twilio": typeof messaging_providers_twilio;
  "messaging/providers/types": typeof messaging_providers_types;
  "messaging/providers/whatsappCloud": typeof messaging_providers_whatsappCloud;
  "messaging/validators": typeof messaging_validators;
  mfa: typeof mfa;
  migrations: typeof migrations;
  notifications: typeof notifications;
  phoneAuth: typeof phoneAuth;
  procurement: typeof procurement;
  productionBackfill: typeof productionBackfill;
  reconciliation: typeof reconciliation;
  reminders: typeof reminders;
  reports: typeof reports;
  sales: typeof sales;
  security: typeof security;
  seed: typeof seed;
  stocking: typeof stocking;
  userAccounts: typeof userAccounts;
  users: typeof users;
  "integrations/apiHttp": typeof integrations_apiHttp;
  publicApi: typeof publicApi;
  events: typeof events;
  apiKeys: typeof apiKeys;
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
