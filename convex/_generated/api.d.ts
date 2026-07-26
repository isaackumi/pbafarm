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
import type * as dailyRecords from "../dailyRecords.js";
import type * as feed from "../feed.js";
import type * as harvest from "../harvest.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_feedLedger from "../lib/feedLedger.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as notifications from "../notifications.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as stocking from "../stocking.js";
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
  dailyRecords: typeof dailyRecords;
  feed: typeof feed;
  harvest: typeof harvest;
  http: typeof http;
  inventory: typeof inventory;
  "lib/authz": typeof lib_authz;
  "lib/feedLedger": typeof lib_feedLedger;
  "lib/tenancy": typeof lib_tenancy;
  notifications: typeof notifications;
  reports: typeof reports;
  seed: typeof seed;
  stocking: typeof stocking;
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

export declare const components: {};
