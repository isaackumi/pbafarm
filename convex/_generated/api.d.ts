/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as apiKeys from "../apiKeys.js";
import type * as assistant from "../assistant.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as automation_checks from "../automation/checks.js";
import type * as automation_conditions from "../automation/conditions.js";
import type * as automation_deliver from "../automation/deliver.js";
import type * as automation_engine from "../automation/engine.js";
import type * as automation_migrations from "../automation/migrations.js";
import type * as automation_rules from "../automation/rules.js";
import type * as automation_schedule from "../automation/schedule.js";
import type * as automation_templates from "../automation/templates.js";
import type * as automation_validators from "../automation/validators.js";
import type * as batches from "../batches.js";
import type * as biweeklyRecords from "../biweeklyRecords.js";
import type * as cages from "../cages.js";
import type * as companies from "../companies.js";
import type * as compliance from "../compliance.js";
import type * as crons from "../crons.js";
import type * as dailyRecords from "../dailyRecords.js";
import type * as emailVerification from "../emailVerification.js";
import type * as emails from "../emails.js";
import type * as expenses from "../expenses.js";
import type * as farmLocations from "../farmLocations.js";
import type * as feed from "../feed.js";
import type * as files from "../files.js";
import type * as fishTransfers from "../fishTransfers.js";
import type * as harvest from "../harvest.js";
import type * as hatchery from "../hatchery.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as idempotency from "../idempotency.js";
import type * as integrations_apiHttp from "../integrations/apiHttp.js";
import type * as integrations_apiScopes from "../integrations/apiScopes.js";
import type * as integrations_openapi from "../integrations/openapi.js";
import type * as integrations_sensorLogic from "../integrations/sensorLogic.js";
import type * as integrations_tables from "../integrations/tables.js";
import type * as integrations_weatherLogic from "../integrations/weatherLogic.js";
import type * as integrations_webhookLogic from "../integrations/webhookLogic.js";
import type * as inventory from "../inventory.js";
import type * as inventoryItems from "../inventoryItems.js";
import type * as lib_analytics from "../lib/analytics.js";
import type * as lib_apiActor from "../lib/apiActor.js";
import type * as lib_authErrors from "../lib/authErrors.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_batchNumbers from "../lib/batchNumbers.js";
import type * as lib_compliance from "../lib/compliance.js";
import type * as lib_costing from "../lib/costing.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_cycles from "../lib/cycles.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_effect from "../lib/effect.js";
import type * as lib_effectHttp from "../lib/effectHttp.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_farmRules from "../lib/farmRules.js";
import type * as lib_feedLedger from "../lib/feedLedger.js";
import type * as lib_fishTransferLogic from "../lib/fishTransferLogic.js";
import type * as lib_growth from "../lib/growth.js";
import type * as lib_hatcheryAccess from "../lib/hatcheryAccess.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_insights from "../lib/insights.js";
import type * as lib_kpi from "../lib/kpi.js";
import type * as lib_llmProviders from "../lib/llmProviders.js";
import type * as lib_memberships from "../lib/memberships.js";
import type * as lib_orgProfile from "../lib/orgProfile.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_productionDualWrite from "../lib/productionDualWrite.js";
import type * as lib_productionEngine from "../lib/productionEngine.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_rollupSchema from "../lib/rollupSchema.js";
import type * as lib_rollups from "../lib/rollups.js";
import type * as lib_scope from "../lib/scope.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_traceability from "../lib/traceability.js";
import type * as lib_unitStatus from "../lib/unitStatus.js";
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
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notifications from "../notifications.js";
import type * as nursery from "../nursery.js";
import type * as phoneAuth from "../phoneAuth.js";
import type * as procurement from "../procurement.js";
import type * as productionBackfill from "../productionBackfill.js";
import type * as publicApi from "../publicApi.js";
import type * as reconciliation from "../reconciliation.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as rollups from "../rollups.js";
import type * as sales from "../sales.js";
import type * as security from "../security.js";
import type * as seed from "../seed.js";
import type * as sensors from "../sensors.js";
import type * as stocking from "../stocking.js";
import type * as tasks from "../tasks.js";
import type * as traceability from "../traceability.js";
import type * as units from "../units.js";
import type * as userAccounts from "../userAccounts.js";
import type * as users from "../users.js";
import type * as weather from "../weather.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  apiKeys: typeof apiKeys;
  assistant: typeof assistant;
  audit: typeof audit;
  auth: typeof auth;
  "automation/checks": typeof automation_checks;
  "automation/conditions": typeof automation_conditions;
  "automation/deliver": typeof automation_deliver;
  "automation/engine": typeof automation_engine;
  "automation/migrations": typeof automation_migrations;
  "automation/rules": typeof automation_rules;
  "automation/schedule": typeof automation_schedule;
  "automation/templates": typeof automation_templates;
  "automation/validators": typeof automation_validators;
  batches: typeof batches;
  biweeklyRecords: typeof biweeklyRecords;
  cages: typeof cages;
  companies: typeof companies;
  compliance: typeof compliance;
  crons: typeof crons;
  dailyRecords: typeof dailyRecords;
  emailVerification: typeof emailVerification;
  emails: typeof emails;
  expenses: typeof expenses;
  farmLocations: typeof farmLocations;
  feed: typeof feed;
  files: typeof files;
  fishTransfers: typeof fishTransfers;
  harvest: typeof harvest;
  hatchery: typeof hatchery;
  health: typeof health;
  http: typeof http;
  idempotency: typeof idempotency;
  "integrations/apiHttp": typeof integrations_apiHttp;
  "integrations/apiScopes": typeof integrations_apiScopes;
  "integrations/openapi": typeof integrations_openapi;
  "integrations/sensorLogic": typeof integrations_sensorLogic;
  "integrations/tables": typeof integrations_tables;
  "integrations/weatherLogic": typeof integrations_weatherLogic;
  "integrations/webhookLogic": typeof integrations_webhookLogic;
  inventory: typeof inventory;
  inventoryItems: typeof inventoryItems;
  "lib/analytics": typeof lib_analytics;
  "lib/apiActor": typeof lib_apiActor;
  "lib/authErrors": typeof lib_authErrors;
  "lib/authz": typeof lib_authz;
  "lib/batchNumbers": typeof lib_batchNumbers;
  "lib/compliance": typeof lib_compliance;
  "lib/costing": typeof lib_costing;
  "lib/crypto": typeof lib_crypto;
  "lib/cycles": typeof lib_cycles;
  "lib/dates": typeof lib_dates;
  "lib/effect": typeof lib_effect;
  "lib/effectHttp": typeof lib_effectHttp;
  "lib/email": typeof lib_email;
  "lib/errors": typeof lib_errors;
  "lib/events": typeof lib_events;
  "lib/farmRules": typeof lib_farmRules;
  "lib/feedLedger": typeof lib_feedLedger;
  "lib/fishTransferLogic": typeof lib_fishTransferLogic;
  "lib/growth": typeof lib_growth;
  "lib/hatcheryAccess": typeof lib_hatcheryAccess;
  "lib/idempotency": typeof lib_idempotency;
  "lib/insights": typeof lib_insights;
  "lib/kpi": typeof lib_kpi;
  "lib/llmProviders": typeof lib_llmProviders;
  "lib/memberships": typeof lib_memberships;
  "lib/orgProfile": typeof lib_orgProfile;
  "lib/phone": typeof lib_phone;
  "lib/productionDualWrite": typeof lib_productionDualWrite;
  "lib/productionEngine": typeof lib_productionEngine;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/rollupSchema": typeof lib_rollupSchema;
  "lib/rollups": typeof lib_rollups;
  "lib/scope": typeof lib_scope;
  "lib/tenancy": typeof lib_tenancy;
  "lib/tokens": typeof lib_tokens;
  "lib/traceability": typeof lib_traceability;
  "lib/unitStatus": typeof lib_unitStatus;
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
  notificationPreferences: typeof notificationPreferences;
  notifications: typeof notifications;
  nursery: typeof nursery;
  phoneAuth: typeof phoneAuth;
  procurement: typeof procurement;
  productionBackfill: typeof productionBackfill;
  publicApi: typeof publicApi;
  reconciliation: typeof reconciliation;
  reminders: typeof reminders;
  reports: typeof reports;
  rollups: typeof rollups;
  sales: typeof sales;
  security: typeof security;
  seed: typeof seed;
  sensors: typeof sensors;
  stocking: typeof stocking;
  tasks: typeof tasks;
  traceability: typeof traceability;
  units: typeof units;
  userAccounts: typeof userAccounts;
  users: typeof users;
  weather: typeof weather;
  webhooks: typeof webhooks;
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
