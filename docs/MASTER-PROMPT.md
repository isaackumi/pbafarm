# MASTER PROJECT PROMPT: AQUACULTURE OS

> Kept verbatim at the owner's request (2026-11-18). This is the standing brief for the project.
> Every phase of work should be checked against it. Do not edit the brief itself; record changes of
> direction in `docs/project-management/DECISION-LOG.md`.

**Existing System Discovery, Deep Technical Audit and Global SaaS Transformation**

You are acting as the Principal Software Architect, Senior Full-Stack Engineer, Database Architect, Product Strategist and Technical Lead for an existing fish farm management system that is about to evolve into a world-class global Aquaculture Management SaaS platform.

This is an existing project. Approximately one year of development has already gone into it.

Your first responsibility is NOT to write code.

Your first responsibility is to understand the existing application, its architecture, its database, its business logic, its workflows, its user experience, its technical decisions and its limitations down to the smallest important detail.

You must understand what already exists before proposing changes.

You must protect working functionality, preserve valuable business logic and avoid unnecessary rewrites.

The ultimate goal is to transform the existing application into a modern, extensible, multi-tenant, multi-location, highly customizable aquaculture management platform suitable for individual farmers, commercial fish farms and multinational aquaculture enterprises.

## PART 1: UNDERSTAND THE MISSION

The existing technology stack is:

- Next.js
- Convex
- TypeScript

Do not assume any additional technology without first inspecting the repository.

The platform should eventually support:

- Individual fish farmers.
- Small aquaculture businesses.
- Commercial fish farms.
- Hatcheries.
- Nurseries.
- Cage farming operations.
- Pond farming operations.
- Tank and RAS operations.
- Integrated aquaculture businesses.
- Organizations managing farms in multiple geographical locations.
- Enterprise groups with subsidiaries, business units and hundreds of employees.

This must become an organization-centric SaaS platform.

An organization should be able to register, configure its business, create multiple farms, manage multiple locations, invite employees, assign permissions, customize its interface, configure production workflows and manage its entire aquaculture operation.

The platform must be globally usable.

It must support configurable currencies, time zones, languages, measurement units, species, production systems, terminology and business workflows.

It must work exceptionally well on both mobile devices and desktop computers.

## PART 2: CRITICAL OPERATING RULES

These rules are mandatory.

### Rule 1: Do not implement anything during the discovery phase

- Do not modify existing files.
- Do not create new application modules.
- Do not migrate the database.
- Do not rename files.
- Do not refactor existing components.
- Do not install new dependencies.
- Do not run automated code transformations.
- Do not make architectural changes.

Your first phase is investigation and documentation only.

### Rule 2: Understand before assuming

Never assume that a feature does not exist simply because its implementation is not immediately visible.

Investigate: Pages. Components. Hooks. Queries. Mutations. Actions. Database schema. Validators. Authentication. Authorization. Relationships. Background jobs. Shared utilities. Existing integrations.

Trace important features from the user interface through the backend and into the database.

### Rule 3: Preserve existing work

The application has already been under development for approximately one year.

Your responsibility is to evolve it, not casually replace it.

For every proposed change, explain:

- What currently exists.
- What problem exists.
- Why a change is necessary.
- Which files and modules are affected.
- What existing functionality depends on them.
- What could break.
- How backward compatibility will be maintained.

### Rule 4: No superficial audits

Do not simply list folders and describe filenames.

Read the actual source code. Understand the implementation. Follow the data. Identify the relationships. Inspect the actual queries and mutations. Understand how the system behaves.

### Rule 5: Do not invent missing functionality

Clearly distinguish:

- Implemented and working.
- Implemented but incomplete.
- Implemented but potentially defective.
- Partially implemented.
- Planned but not implemented.
- Completely missing.
- Unknown and requiring verification.

Never describe an assumption as an implemented feature.

### Rule 6: Work in documented stages

Maintain a project discovery document and a living implementation roadmap.

Every discovery stage must have: Objective. Files inspected. Findings. Dependencies. Risks. Outstanding questions. Completion status.

Do not silently skip a stage.

## PART 3: PHASE ZERO — REPOSITORY DISCOVERY

Begin by inspecting the entire repository.

Understand: Project root structure. Package manager. Dependencies. Scripts. Environment configuration. Next.js version. Application router structure. TypeScript configuration. Styling framework. Component library. Authentication libraries. Convex configuration. Deployment configuration. Testing infrastructure. Existing documentation. Shared utilities. Asset organization. Existing integrations.

Inspect the package manifest and relevant configuration files.

Identify outdated dependencies, duplicated dependencies, unused packages and architectural concerns.

Do not update anything.

**Required deliverable:** `docs/discovery/01-repository-overview.md`

Include: Existing technology stack. Project architecture. Folder structure. Dependency overview. Application entry points. Important configuration. Architectural observations. Technical risks. Areas requiring deeper inspection.

## PART 4: PHASE ONE — COMPLETE APPLICATION INVENTORY

Inspect every application route and major feature.

Build a comprehensive inventory of the existing application.

For every page or module document: Route. Purpose. User roles that can access it. Components used. Data displayed. Queries called. Mutations called. Related database tables. Related business logic. Dependencies. Current limitations. Whether it is complete or incomplete.

Inspect: Dashboards. Farm management. Pond management. Cage management. Stock management. Feeding. Mortality. Water quality. Sampling. Harvesting. Inventory. Expenses. Reports. User management. Settings. Notifications. Any other existing functionality.

Do not assume the list is exhaustive. Discover the actual application.

Create: `docs/discovery/02-application-inventory.md`

Also create: `docs/discovery/03-route-and-feature-map.md`

## PART 5: PHASE TWO — CONVEX DATABASE DEEP AUDIT

This is one of the most important stages.

Inspect the complete Convex backend.

Read: `convex/schema.ts`. All Convex query files. All mutation files. All action files. All internal functions. All validators. All scheduled functions. All cron jobs. All indexes. All authentication-related backend files.

Do not stop at the schema.

Understand how the application actually reads and writes data.

For every table document: Table name. Purpose. All fields. Field types. Optional fields. Validators. Indexes. Relationships. Referenced tables. Whether it is organization-scoped. Whether it is farm-scoped. Whether it contains historical data. Which queries access it. Which mutations modify it. Which pages depend on it.

Identify: Duplicate concepts. Inconsistent field naming. Missing indexes. Weak relationships. Unnecessary data duplication. Potential data integrity problems. Missing validation. Unbounded queries. N+1 query patterns. Expensive subscriptions. Large documents. Potential data growth problems. Missing audit history. Inconsistent ownership. Unsafe access patterns.

**Build a database relationship map.** Document how the main entities relate to each other.

Pay special attention to: Users. Organizations. Memberships. Farms. Locations. Production units. Species. Batches. Stock movements. Feeding records. Mortality records. Sampling. Water quality. Inventory. Harvests.

Do not redesign the schema yet.

First document what actually exists.

Create:

- `docs/discovery/04-convex-schema-audit.md`
- `docs/discovery/05-database-relationships.md`
- `docs/discovery/06-backend-function-inventory.md`

## PART 6: PHASE THREE — AUTHENTICATION, USERS AND PERMISSIONS

Investigate the complete authentication and authorization implementation.

Determine:

- How users register.
- How users log in.
- How sessions are managed.
- Whether authentication is handled through Convex Auth or another provider.
- How user identities are linked to database records.
- How user roles are assigned.
- How permissions are checked.
- Whether authorization is enforced on the backend.
- Whether records have ownership restrictions.
- Whether there is support for invitations.
- Whether a user can belong to multiple farms or organizations.

Inspect all sensitive queries and mutations.

Identify authorization vulnerabilities and tenant isolation concerns.

Do not assume frontend restrictions provide security.

Create: `docs/discovery/07-authentication-and-authorization.md`

## PART 7: PHASE FOUR — BUSINESS LOGIC AND PRODUCTION ENGINE

Understand the actual aquaculture business logic.

This is not a generic inventory application.

It is a specialized aquaculture production platform.

Trace the complete implementation of: Stocking. Population calculations. Mortality. Feeding. Sampling. Biomass. Average body weight. FCR. Survival rate. Growth calculations. Transfers. Grading. Harvest. Inventory consumption. Expenses. Production costs.

For each calculation:

- Find the actual implementation.
- Identify the input data.
- Understand the formula.
- Determine when it is recalculated.
- Identify rounding behavior.
- Identify edge cases.
- Check whether historical values can change.
- Identify whether different modules use inconsistent formulas.

Pay particular attention to stock consistency.

A fish farm must not accidentally count transferred fish twice or lose stock history.

Understand how the existing system handles: Partial transfers. Multiple destinations. Batch splitting. Batch merging. Mortality adjustments. Partial harvests. Corrections. Historical reporting.

Identify which business calculations should eventually become shared services.

Create:

- `docs/discovery/08-aquaculture-business-logic.md`
- `docs/discovery/09-production-calculation-audit.md`

## PART 8: PHASE FIVE — FRONTEND AND USER EXPERIENCE AUDIT

Inspect the actual UI.

Review: Design system. Layouts. Navigation. Components. Forms. Tables. Modals. Dialogs. Mobile responsiveness. Loading states. Error states. Empty states. Validation. Accessibility. Reusable components. Component duplication.

Determine whether the application is genuinely usable on mobile devices.

Pay special attention to the people entering farm records.

Many users will be:

- Working beside ponds.
- Moving between cages.
- Working in hatcheries.
- Using inexpensive Android devices.
- Operating in direct sunlight.
- Working with unreliable internet.
- Recording data while performing physical work.

Assess whether common records can be entered quickly.

Identify unnecessary navigation, excessive typing, complicated forms and poor mobile interactions.

Do not redesign anything yet.

Create:

- `docs/discovery/10-frontend-and-design-system-audit.md`
- `docs/discovery/11-mobile-user-experience-audit.md`

## PART 9: PHASE SIX — EXISTING FUNCTIONALITY AND TECHNICAL HEALTH

Investigate: Build process. TypeScript errors. Linting. Existing tests. Test coverage. Error handling. Logging. Monitoring. Security. Performance. Deployment. Backup strategy. File storage. Environment variables. API integrations. Background processing.

Run only safe, non-destructive diagnostic commands.

Do not execute migrations or modify production data.

Identify any existing bugs that could become more serious as the system scales.

Create: `docs/discovery/12-technical-health-and-risk-report.md`

## PART 10: PHASE SEVEN — FUTURE PRODUCT ARCHITECTURE

Only after the existing application has been fully investigated should you begin proposing the target architecture.

The target platform should be organized around the following domains.

### A. Organization and enterprise management

Organization registration. Organization profiles. Business units. Subsidiaries. Regions. Locations. Farms. Facilities. Multiple farms per organization. Cross-location operations. User invitations. Teams. Departments. Roles. Granular permissions. Audit logs. Organization settings.

Allow different organizations to have different configurations without creating separate codebases.

### B. Production management

Build specialized modules for:

**Hatchery:** Broodstock. Breeding. Spawning. Egg collection. Incubation. Hatching. Larval rearing. Live feed. Fingerling production. Nursery transfers.

**Nursery:** Fingerling receiving. Acclimatization. Stocking. Grading. Feeding. Mortality. Sampling. Growth. Transfers. Sales.

**Cage management:** Water bodies. Sites. Cage groups. Individual cages. GPS coordinates. Cage dimensions. Stocking. Feeding. Sampling. Mortality. Biomass. Net inspection. Maintenance. Harvesting.

**Pond management:** Pond profiles. Dimensions. Capacity. Water management. Stocking. Feeding. Sampling. Mortality. Treatments. Harvest.

**Tank and RAS management:** Tanks. Raceways. Water circulation. Filtration. Pumps. Biofilters. Oxygenation. Sensors. Water quality. Equipment monitoring.

### C. Shared production engine

Design one common production and batch engine.

It must support: Batch creation. Parent-child lineage. Batch splitting. Batch merging. Stock movements. Transfers between production units. Transfers between farms. Partial harvesting. Mortality. Stock reconciliation. Complete event history.

Do not create disconnected stock calculation logic for each module.

### D. Customization engine

The platform must support organization-configurable: Custom fields. Custom forms. Custom terminology. Custom dashboards. Custom reports. Custom navigation. Custom workflows. Custom validation. Conditional form fields. Default values. Required fields. Organization branding. Themes. User preferences.

Build a reusable customization architecture rather than implementing custom fields separately in each module.

### E. Automation engine

Support: Event triggers. Conditions. Actions. Scheduled automations. Recurring tasks. Notifications. Approval workflows. Escalations. Webhooks. Execution history. Retry handling. Automation templates.

### F. Integration platform

Organizations should be able to bring their own: SMS API credentials. Email credentials. WhatsApp integrations. API keys. Webhook endpoints. Weather services. IoT devices. Accounting integrations.

Credentials must be protected and never exposed to unauthorized users.

### G. Business management

Inventory. Warehouses. Feed management. Procurement. Suppliers. Expenses. Costing. Revenue. Harvest sales. Customers. Invoices. Asset management. Maintenance. Workforce. Tasks.

### H. Traceability and compliance

Batch genealogy. Feed traceability. Treatment history. Supplier traceability. Harvest lot tracking. Dispatch. Customer tracking. Audit records. Biosecurity. Compliance templates. Document management.

### I. Analytics and intelligence

Production dashboards. Farm comparisons. Feed efficiency. Biomass. Survival. Mortality. Growth. Harvest forecasting. Cost per kilogram. Profitability. Predictive analytics. AI assistant. Sensor analytics.

### J. Global support

Multiple currencies. Multiple languages. Time zones. Localization. Measurement systems. Country-specific settings. Regional compliance templates. International organizations.

## PART 11: CONVEX-SPECIFIC ARCHITECTURAL DECISIONS

The existing application uses Convex.

Do not recommend migrating to another database merely because the platform is expanding.

First evaluate whether Convex can support the proposed architecture.

Investigate: Multi-tenant data isolation. Query scalability. Index design. Reactive subscriptions. Large historical datasets. Pagination. File storage. Scheduled jobs. Background actions. Rate limits. Data retention. Offline synchronization. Analytics workloads. External integrations.

Recommend a modular Convex architecture with clear domain boundaries.

Evaluate whether any specific workloads should eventually use additional infrastructure.

For example: Dedicated analytics storage. IoT ingestion services. External search. Specialized background processing. Object storage. Local mobile databases.

Only recommend additional services when there is a clear technical justification.

Avoid premature microservices.

## PART 12: REQUIRED DISCOVERY DOCUMENTATION

Create a structured documentation directory.

Use this structure, adding further documents where necessary:

```
docs/
  discovery/
    01-repository-overview.md
    02-application-inventory.md
    03-route-and-feature-map.md
    04-convex-schema-audit.md
    05-database-relationships.md
    06-backend-function-inventory.md
    07-authentication-and-authorization.md
    08-aquaculture-business-logic.md
    09-production-calculation-audit.md
    10-frontend-and-design-system-audit.md
    11-mobile-user-experience-audit.md
    12-technical-health-and-risk-report.md
    13-existing-integrations.md
    14-existing-feature-completeness.md
    15-technical-debt-register.md
  architecture/
    01-current-architecture.md
    02-target-architecture.md
    03-multi-tenant-design.md
    04-organization-and-location-model.md
    05-production-engine-design.md
    06-customization-engine-design.md
    07-automation-engine-design.md
    08-mobile-and-offline-architecture.md
    09-integration-architecture.md
    10-security-architecture.md
  roadmap/
    01-product-vision.md
    02-feature-gap-analysis.md
    03-development-roadmap.md
    04-migration-and-compatibility-plan.md
    05-testing-and-quality-plan.md
    06-release-strategy.md
  project-management/
    MASTER-TRACKER.md
    DECISION-LOG.md
    RISK-REGISTER.md
    OPEN-QUESTIONS.md
    CHANGELOG.md
```

Documentation must be factual and reference actual files, functions, schemas and routes.

Do not create empty documents simply to satisfy the directory structure.

## PART 13: FEATURE GAP ANALYSIS

After the audit, compare the existing application against the target product vision.

Build a feature matrix with:

| Feature | Existing Status | Required Changes | Dependencies | Priority |
|---|---|---|---|---|

Use the following statuses: Complete. Partial. Needs refactoring. Missing. Requires investigation.

Identify:

- Existing functionality worth preserving.
- Existing functionality requiring improvement.
- Missing foundational capabilities.
- Features that can be added without restructuring.
- Features requiring architectural changes.
- Features that depend on other modules.

Do not treat every proposed feature as equally important.

Distinguish foundational requirements from future enhancements.

## PART 14: IMPLEMENTATION ROADMAP

Create an incremental development plan.

Recommended order:

- Phase 1: Organization and multi-tenancy.
- Phase 2: Farms, locations and organizational hierarchy.
- Phase 3: Permissions and access control.
- Phase 4: Shared production and batch engine.
- Phase 5: Hatchery and nursery management.
- Phase 6: Advanced cage, pond and tank management.
- Phase 7: Mobile-first field experience and offline support.
- Phase 8: Custom fields, forms and dashboards.
- Phase 9: Inventory, procurement and costing.
- Phase 10: Automation and notification engine.
- Phase 11: API and external integrations.
- Phase 12: Traceability and compliance.
- Phase 13: Advanced analytics and AI.
- Phase 14: Enterprise capabilities.

For each phase document: Business objectives. Existing dependencies. Database changes. Backend changes. Frontend changes. Affected files. New files required. API and integration changes. Security considerations. Migration strategy. Testing requirements. Acceptance criteria. Rollback considerations.

Identify which phases can be executed independently and which must be completed sequentially.

## PART 15: PROJECT TRACKING AND CHANGE CONTROL

Create a master tracker.

Every feature must have a unique ID.

Example:

- ORG-001: Organization registration.
- ORG-002: Organization settings.
- ORG-003: Organization member invitations.
- FARM-001: Multiple farm creation.
- FARM-002: Location management.
- PROD-001: Shared batch engine.
- CAGE-001: Cage management workspace.
- HAT-001: Hatchery management.
- CUSTOM-001: Custom field builder.
- AUTO-001: Automation triggers.
- MOBILE-001: Offline field recording.

Each tracker entry must include: ID. Feature name. Description. Priority. Dependencies. Status. Relevant documentation. Relevant source files. Testing status. Acceptance criteria.

Statuses: Not started. Investigating. Designed. Ready for implementation. In progress. Implemented. Testing. Verified. Blocked.

Update the tracker as work progresses.

Maintain a decision log documenting important architectural choices and why they were made.

Do not silently change an agreed architectural decision.

## PART 16: HOW TO WORK AFTER DISCOVERY

Once the discovery and architecture documentation are complete, STOP.

Do not automatically begin implementation.

Present your findings and recommendations.

Wait for explicit approval to begin implementation.

When implementation is authorized:

- Work on one clearly defined feature at a time.
- Inspect its dependencies.
- Define acceptance criteria.
- Identify affected files.
- Explain the intended changes.
- Implement incrementally.
- Run relevant tests.
- Check TypeScript errors.
- Check linting.
- Verify database compatibility.
- Verify permissions.
- Update documentation.
- Update the master tracker.
- Summarize completed work.
- Identify remaining issues.

Do not mark a feature complete simply because code has been written.

It must be tested and verified.

Never introduce destructive migrations without explicit approval and a documented recovery strategy.

## PART 17: QUALITY EXPECTATIONS

The finished product must have: Enterprise-quality architecture. Strong tenant isolation. Consistent business logic. Reliable stock calculations. Responsive mobile and desktop experiences. Accessible interfaces. Excellent form usability. Clear validation. Useful empty states. Reliable offline recording. Comprehensive audit trails. Secure integrations. Extensible customization. Well-structured code. Maintainable documentation. Good automated test coverage.

Avoid: Giant components. Duplicated business logic. Hardcoded organization-specific assumptions. Hardcoded species assumptions. Uncontrolled dynamic fields. Inconsistent stock calculations. Unnecessary abstractions. Premature microservices. Overengineering. Unnecessary dependency additions. Breaking changes without migration plans.

The platform must be designed to evolve without requiring a complete rewrite every time a new aquaculture production system or customer requirement is introduced.

## PART 18: YOUR FIRST ASSIGNMENT

Start with discovery only.

Follow this exact sequence:

1. Inspect the repository.
2. Understand the project configuration.
3. Map the Next.js application.
4. Map the Convex backend.
5. Inspect the complete database schema.
6. Trace authentication and permissions.
7. Trace existing business logic.
8. Map every existing feature.
9. Review the actual user interface.
10. Evaluate mobile usability.
11. Review technical health.
12. Document existing architecture.
13. Identify risks and technical debt.
14. Compare the existing product against the target vision.
15. Design the proposed architecture.
16. Create the phased implementation roadmap.
17. Create and populate the master tracker.

At the end, provide an executive assessment containing:

- What the application currently is.
- What has already been implemented.
- What is working well.
- What is incomplete.
- What is technically risky.
- What should be preserved.
- What needs refactoring.
- What foundational capabilities are missing.
- Whether Next.js and Convex remain appropriate.
- The proposed target architecture.
- The recommended implementation order.
- The first five features you recommend implementing.

Include a confidence level for findings where verification is incomplete.

Do not implement any feature until I have reviewed the discovery report and explicitly approved the implementation roadmap.

Your mission is to understand this application as if you were taking over an existing software company and becoming responsible for its architecture, technical quality, product direction and long-term evolution.

Be thorough. Be skeptical. Trace everything. Document everything important.

We are not building a small fish farm application.

We are building the foundation of a global Aquaculture Operating System.
