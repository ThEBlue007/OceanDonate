---
name: backend-architecture
description: Use when writing, reviewing, or refactoring TypeScript/Node.js backend application or API code where backend design guidance is useful, including APIs, routes, controllers, middleware, SDKs, services, repositories, database access, runtime workers, and external integrations that implement backend behavior. Do not use merely because code runs in Node.js or on a server. Skip CI/workflow configuration, deployment or maintenance scripts, demos, tests, simple renames, formatting, documentation-only work, and other mechanical or supporting work that does not require backend design guidance. Do not use for localized bug fixes when the cause and edit location are already known, even when the affected code is part of an SDK or backend component.
license: MIT
---

# Backend Architecture

Use this skill for TypeScript and Node.js backend work. It is framework-neutral: apply it to Fastify, Express, Hono, Workers, queues, CLIs, SDKs, database packages, integration modules, and service packages by mapping the same responsibilities to the local framework.

## First Move

Before changing code:

- Read repo guidance first: `AGENTS.md`, package READMEs, existing conventions, local test setup, and nearby code.
- Inspect the current package layout, imports, naming, server entrypoints, db/repo code, helpers, and tests.
- Prefer existing repo conventions when they are clear. Use this skill as the default for new code, ambiguous code, or code that needs architectural cleanup.
- Search before creating a new helper, service, schema, repository, middleware, or shared type. Consolidate similar code instead of adding another near-duplicate.
- Identify the canonical source of truth for contracts and generated files before editing schemas or DTOs.

Default posture: **boundaries early, implementations lean**.

> Decide the app or package layer structure early and follow it consistently; do not let each use case invent its own onion. Keep code inside each chosen boundary as direct as its responsibility allows.

## Core Principles

- Use TypeScript for backend code. Prefer strict, explicit domain models over loose objects.
- Use progressive disclosure: make top-level use-case orchestration read linearly in domain terms, keep the happy path visible, and push parsing, process, protocol, and storage mechanics into the boundary that owns them.
- Keep things simple and local until reuse is real.
- Name things by domain responsibility: `MailboxRepository`, `ProvisioningService`, `createRepository`, `WebhookCryptoService`.
- Avoid vague names like `Manager`, `Handler`, `Processor`, or `Util` unless the framework or domain role is genuinely vague.
- Give state and its invariants one owner. Ask that owner to perform domain operations instead of exposing state for callers to coordinate.
- Use ESM and `node:` imports for Node builtins when the repo supports them.
- Keep generated files clearly marked and avoid hand-editing them unless the repo explicitly expects it.
- Prefer deep modules that hide meaningful complexity over shallow helpers, barrels, and single-purpose indirection.
- Avoid "spaghetti DRY": centralization is good only when it simplifies call sites and ownership.
- Do not invent future state or defensive machinery without evidence. Leave a clear TODO for unimplemented behavior; security, data integrity, cleanup, and documented runtime contracts remain required.
- Keep server-only packages out of browser bundles; add an explicit runtime guard if accidental browser import would be dangerous.
- Follow repo-local formatting, linting, and import ordering over personal preference.

## Architecture Boundaries

Use functional core / imperative shell as a mental model: keep domain decisions independent of I/O mechanics, and let application workflows coordinate repositories and integrations. Map those responsibilities before writing code.

### Routes, Controllers, And Middleware

Routes/controllers should own transport concerns:

- HTTP method, path, status code, request/response shape.
- Caller and request state, authentication, and guard wiring.
- Request parsing and schema validation.
- Request-specific policy that decides whether and how the use case may start.
- Delegating trusted input to services or repositories.
- Mapping expected domain outcomes to transport responses.

Prefer config-driven route declarations when the framework supports them. Declaring auth, guards, input/output schemas, and rate limits on route config keeps handlers lean and makes authorization reviewable at a glance. This Fastify-style example is illustrative; keep the same shape in other frameworks instead of copying the exact APIs:

```ts
fastify.post("/mailboxes", {
  config: {
    auth: ["bearer"],
    input: { schema: CreateMailboxRequest },
    output: { schema: MailboxDTO },
    guards: [hasActiveOrganization(), scopeAllows("mailbox:create")],
  },
  handler: async (request, reply) => {
    const input = CreateMailboxRequest.parse(request.body)
    const mailbox = await fastify.provisioning.createMailbox(input)
    return reply.code(201).send(mailbox)
  },
})
```

When the framework has no config-driven routes, keep the same separation by calling guards and validators at the top of the handler, then delegating to services.

```ts
async function provisionMailboxController(mailbox: MailboxDraft) {
  await userGuard(mailbox.user.id, "mailbox.create")
  const provisioned = await provisionMailbox(mailbox)
  return MailboxSchema.parse(provisioned)
}
```

The second example assumes `MailboxDraft` is already parsed, trusted request input. It expresses the same boundary without a route DSL: the controller owns ACL and public DTO parsing, while `provisionMailbox` receives trusted input and remains unaware of transport state.

Standardize transport responses and error envelopes once per app or framework boundary. Do not invent ad-hoc response formats per route.

Frontend apps can have backend surfaces too: server actions, middleware, integrations, scheduled tasks, route handlers, and server-only packages. Treat them with the same boundary discipline as a standalone API.

Middleware/plugins/hooks should be thin composition layers:

- Build request context.
- Wire shared dependencies.
- Enforce auth, guards, validation, rate limits, CORS, security headers, tracing, and logging.
- Decorate the app/server with services, repositories, clients, or request helpers.

Do not put long business workflows in middleware. Move workflows into services and keep middleware focused on composition and cross-cutting behavior.

### Guards And Authorization

Guards are composable authorization checks that run before route handlers. They separate "who can do this" from "what this does."

- Keep each guard focused on one authorization concern: membership, role, scope, plan limit, resource ownership.
- Use named factory functions for common guard types: identity, permission, resource ownership, plan/limit, and conditional guards.
- Prefer route/config-level guard declaration when available. Otherwise run guards at the top of the handler before business work starts.
- Fail closed: guarded routes should also declare authentication, and missing auth should be caught at startup or route registration when possible.
- Use the framework's normal rejection style consistently. Do not force every codebase into one `throw` or `reply` pattern.
- Return `404` instead of `403` when revealing that a cross-tenant resource exists would leak information.

### Plugins And Module Lifecycle

Plugins and modules wire infrastructure into the server. They should be thin, declare their dependencies, and register in a predictable order.

- Register plugins sequentially in the composition root (server bootstrap). Order matters: database before repositories before services before auth before guards.
- Declare dependencies explicitly when the framework supports it.
- Each plugin should decorate the server/app with the service or client it owns, then stop. Do not chain business logic in plugin registration.
- Use framework type augmentation or typed locals/context so decorated services are safe at call sites.
- In tests, replace or skip non-essential infrastructure intentionally. Do not let CORS, rate limits, schedulers, or listeners make backend tests noisy.

### Integrations And Runtime Context

Framework integrations should wire runtime context and lifecycle:

- Register middleware/hooks.
- Inject typed locals/context.
- Create long-lived clients and repository providers.
- Inject generated ambient types when the framework needs them.
- Run non-critical migrations or boot checks only when failure is safe and logged.

Keep integration modules idempotent. In dev servers, HMR or module re-evaluation can create duplicate schedulers, clients, or listeners. Use explicit guards and dispose/cleanup hooks when the runtime supports them.

### Services

Services own application workflows:

- Coordinate repositories, external clients, workers, queues, mailers, and SDKs.
- Enforce business sequencing that crosses persistence and outside-world effects.
- Decide how to recover from external failures.
- Emit logs around important lifecycle steps, transitions, and failures.

Services may be single-purpose operations or orchestrators. They receive trusted inputs, return internal or domain outputs, and own durable business rules and workflow sequencing—not caller state, transport policy, or public response formatting.

Keep orchestrators flat and readable by composing intention-revealing operations:

```ts
async function provisionMailbox(mailbox: MailboxDraft) {
  const reserved = await mailboxes.reserve(mailbox)
  const provisioned = await mailServer.provision(reserved)
  await mailboxes.activate(reserved.id, provisioned)
  return provisioned
}
```

Services may call external systems. Repositories should not.

When a service coordinates persistence and external systems, order operations by source of truth and handle failures with explicit cleanup:

- **Reserve locally first, then provision externally.** If the external call fails, clean up the local record or mark it as failed. This prevents orphaned external resources.
- **Update the source of truth first for rotations/updates.** When rotating a token, update the external provider before persisting the new hash locally. If the external update fails, the old local value stays valid.
- **Use non-blocking side effects for non-critical work.** Fire-and-forget with a catch-and-warn pattern for welcome emails, analytics, or notifications that should not block the main workflow.

When a side effect is intentionally non-blocking, make that visible in code and always attach catch-and-warn logging.

Use classes for stateful services, services with injected dependencies, lifecycle, logging context, or multiple public workflow methods. Use functions for pure transformations and one-off behavior.

### Repositories

Repositories should be rich enough to justify their existence. A repository that only wraps `db.table.create(data)` is usually noise.

Treat the database client as raw infrastructure: Prisma, Drizzle, SQL builders, or any other client object. Treat repositories as the smart persistence layer around that client. Individual repositories can be constructed directly with the client in tests, while the app usually receives a repository factory graph.

Repositories own persistence behavior:

- Queries and query composition.
- Defaults and storage-level validation.
- Entity state transitions.
- Database transactions for persistence workflows.
- Creating, updating, or deleting multiple database records as one storage operation.
- Database-backed audit/outbox rows and parent/child updates.
- Pagination and sorting defaults.
- Parsing raw rows into durable DTOs or schemas before returning.

Repository side effects must stay inside the database. Do not call external APIs, queues, mailers, SDKs, HTTP clients, or file systems from repositories.

Transactions are normally a repository detail. Service-level transactions are valid for genuine cross-repository workflows, but do not add `tx` parameters to every method by default. Add transaction support only where the workflow needs it.

Use a `BaseRepo` or shared repository helper when it removes real repetition: pagination, `findOrThrow`, row parsing, audit defaults, slug helpers, or common transaction helpers. Keep it boring and storage-oriented. Do not turn it into a generic business framework.

### External Systems

Wrap third-party APIs, SDKs, queues, email providers, payment providers, and infrastructure clients behind your own service or adapter.

Routes and core business logic should call your application boundary, not a vendor SDK directly. This keeps configuration, logging, retries, error mapping, test doubles, and future replacement in one place.

For SDK-style packages:

- Provide a small facade over generated/protocol clients.
- Normalize protocol callback APIs into promise-based application methods.
- Set deadlines/timeouts at the client boundary.
- Return typed domain responses for expected remote outcomes.
- Hide internal transport errors from user-facing responses when appropriate.
- Support dependency injection of the underlying client so tests can use typed mocks.
- Expose explicit `disconnect`/cleanup when the client owns sockets or processes.

Use discriminated result types when external operations have expected failure modes that callers need to branch on:

```ts
type ProvisionResult<T> = { ok: true; data: T; warnings?: string[] } | { ok: false; error: string }
```

This avoids try/catch for expected outcomes and makes the caller's branching explicit. Reserve exceptions for unexpected infrastructure failures.

When an external client or service has groupable sub-domains, use a facade class with typed sub-modules that share a common transport or runtime context. Unit-test the sub-modules directly, but let the rest of the app interact with the facade.

```ts
class MailServer {
  readonly mailboxes: MailServerMailbox
  readonly domains: MailServerDomain

  constructor(config: MailServerConfig) {
    const ctx = createSharedContext(config)
    this.mailboxes = new MailServerMailbox(ctx, config.mailboxDefaults)
    this.domains = new MailServerDomain(ctx)
  }
}
```

## Files And Names

Use mostly strict naming:

- Kebab-case filenames: `webhook-dispatch.service.ts`, `organization-domain.repo.ts`.
- Suffix files with their archetype when it helps: `.service.ts`, `.repo.ts`, `.plugin.ts`, `.module.ts`, `.schema.ts`, `.dto.ts`, `.test.ts`.
- Omit suffixes when the directory or repo convention already makes the role obvious, such as `routes/api/mailbox.ts`.
- Prefer feature/domain grouping over technical junk drawers.
- Avoid deep nesting unless each level represents real ownership.

Common shapes include `routes/services/plugins/lib/schemas`, domain folders such as `domains/mailbox`, or package boundaries such as `spec/db/api/utils`. Use the repo's shape first. The point is ownership, not exact folder names.

## Types, Schemas, And Contracts

Use runtime schemas at trust boundaries:

- HTTP request bodies, params, query strings, and responses.
- Webhooks and external events.
- Env/config values.
- Database rows crossing into public DTOs.
- Queue/job payloads.

Schema placement:

- Keep route-specific request schemas near the route/module.
- Centralize durable domain contracts, DTOs, database table definitions, auth/config specs, shared event payloads, and public API shapes early.
- If a type is app-wide, security-sensitive, part of config, or used by multiple packages, centralize it.
- If a type is owned by one feature/domain, keep it in that feature/domain.
- If a type is tiny and local to one function or file, keep it inline.
- Create local `types.ts` or helper files only when the source file becomes hard to read.

Parse at the boundary that owns the data: requests and public responses in controllers, persisted rows in repositories, and provider payloads in integrations. Pass the resulting trusted values inward instead of continuing to pass raw values through the system:

```ts
const CreateMailboxRequest = z.object({
  localPart: z.string().optional(),
  name: z.string().optional(),
})

route.post("/mailboxes", async (request) => {
  const input = CreateMailboxRequest.parse(request.body)
  return mailboxService.create(input)
})
```

Repositories should return parsed durable shapes when possible:

```ts
class MailboxRepository {
  async getById(id: string) {
    const row = await db.query.mailbox.findFirst({ where: { id } })
    return row ? MailboxDTO.parse(row) : null
  }
}
```

Use discriminated unions when fields represent mutually exclusive states. Make illegal combinations difficult to construct instead of documenting them as nullable-field conventions.

Use return type inference by default. Add explicit return types when they clarify public contracts, exported factories, public class methods, async boundary behavior, or repo-local lint rules require them.

### Single Source Of Truth

Use one canonical contract source for durable shapes. Good patterns:

- Database table definitions generate insert/select schemas and raw DB types.
- DTO schemas extend or narrow generated table schemas.
- Controllers parse service results through public DTOs before responding.
- SDK clients normalize generated protocol types into app-owned response types.

Bad patterns:

- Manually maintaining the same API shape in YAML, JSON Schema, Zod, and TypeScript.
- Copying request/response types into each layer instead of deriving or importing them.
- Generating code from multiple competing sources without a documented owner.

If multiple contract formats are required, generate the secondary formats from the canonical source. Do not hand-maintain parallel truths.

## Code Generation

When the codebase uses a build step to generate schemas, repository factories, barrel exports, or route trees, treat the generation pipeline as infrastructure.

- Mark generated files clearly with a `.gen.ts` suffix or a header comment. Never hand-edit generated output unless the pipeline explicitly expects it.
- Keep the generator script simple and sequential. Named steps with logging make failures easy to trace.
- Generate secondary artifacts from one canonical source: schemas from table definitions, public types from DTO schemas, factory indexes from implemented modules, or route trees from route files.
- Run generation as part of the normal build/test pipeline when stale output would break consumers.
- Document the regeneration command near the package that owns the generator.
- When adding an entity, update the hand-written source first, then regenerate derived files.

## Classes, Dependency Injection, And Factories

Use classes when the object owns dependencies, state, lifecycle, logging context, or a cohesive set of public methods. A service does not need to be a class merely because it participates in the chosen architecture.

Construct backend services, repositories, adapters, facades, and modules once at composition time when they benefit from object ownership. Prefer one app graph per process, test app, worker, or request scope. Avoid model-driven classes where each database row becomes an object with behavior unless the local codebase clearly uses that style. Avoid inheritance by default; use it only for stable infrastructure mechanics that remove real repetition.

Use functions when behavior is pure, stateless, or better represented as a guard/helper/transform.

Keep state transitions behind the class, service, or module that owns the invariant; callers should request the domain operation rather than coordinate internal mutations.

Default to concrete dependencies:

```ts
class BillingService {
  constructor(
    private readonly users: UserRepository,
    private readonly payments: PaymentService,
    private readonly logger: Logger,
  ) {}
}
```

Use a narrow dependency shape only when the dependency is intentionally tiny:

```ts
type TokenSigner = {
  sign(payload: TokenPayload): string
}

class SessionService {
  constructor(private readonly tokenSigner: TokenSigner) {}
}
```

Avoid named ports/interfaces by default. They add another contract that can drift. Introduce them only for a real boundary with multiple implementations, package independence, or a testability problem that concrete injection cannot solve cleanly.

Use factories for standard wiring, not simple object creation. Repository factories may accept the raw database client and return smart repository instances; derive the graph type with `ReturnType` instead of duplicating it by hand.

Factories are useful when:

- Many dependencies need consistent construction.
- Tests need a repeatable app/repo/service graph.
- A framework plugin/module decorates the runtime with shared objects.
- Configuration and lifecycle must be centralized.

## Config DSLs, Registries, And High-Level Abstractions

Design high-level abstractions when a domain has repeated configuration, execution context, and many variants. Keep the abstraction concrete enough to make call sites simpler than direct code.

Good use cases:

- Agent/tool/provider registries.
- Chart or report configuration DSLs.
- Job pipelines with typed steps.
- Seeders and fixture loaders.
- SDK facades over generated clients.
- Framework integrations that wire middleware and typed locals.

Rules:

- Prefer `defineX()` helpers when you want strong inference and a clean authoring surface.
- Keep config objects declarative and execution wrappers small.
- Separate static config from runtime context.
- Use registries for discoverability and type-safe lookup.
- Make registries throw clear errors for unknown keys.
- Support categories or groups only when they simplify call sites.
- Add tests for the resolver/factory, not just each variant.

Example:

```ts
export function defineTool<const T extends ToolConfig>(config: T): T {
  return config
}

const TOOL_CONFIG = {
  catalog: {
    search: defineTool({ name: "Catalog search", input, output }),
  },
  chart: {
    cartesian: defineTool({ name: "Cartesian chart", input, output }),
  },
} as const

export function getTools(keys: Array<ToolKey | ToolCategory>) {
  const selected = resolveToolConfigs(TOOL_CONFIG, keys)
  return (context: ToolContext) => Object.fromEntries(selected.map((tool) => [tool.id, tool.withContext(context)]))
}
```

Avoid a DSL when:

- There are only one or two variants.
- The abstraction hides simple code behind type gymnastics.
- The config has become another source of truth for behavior that lives elsewhere.
- Each variant still needs extensive custom branching after resolution.

## Workflow Pipelines

For multi-step workflows, prefer an explicit pipeline when order, shared state, abort behavior, or streaming/output control matters.

Use:

- A typed mutable execution state for accumulated workflow data.
- Small step functions with a shared signature.
- Centralized error handling in the orchestrator.
- Explicit `next()` / `abort()` or equivalent flow control when steps can stop the pipeline.
- Dedicated control objects for exclusive resources like stream writers, locks, or transactions.

Steps should not each invent their own try/catch policy. Let the orchestrator own unexpected errors and let steps return typed outcomes or abort expected failures.

## Helpers And Shared Utilities

Extract a helper when it names a real concept, hides meaningful complexity, or stable repetition has emerged. Prefer one deep operation over a chain of shallow helpers. Search first.

Before adding a helper:

- Look for existing helpers with overlapping behavior.
- Check whether the new helper can consolidate similar past and present use cases.
- Give it a specific name. Avoid `utils.ts` growing into unrelated functions.
- Add focused tests when parsing, normalization, security, crypto, dates, IDs, or edge cases are involved.

Do not create one file for every tiny function or extract a helper just to DRY one line. Keep tiny single-use logic inline until extraction makes the caller clearer or prevents meaningful duplication.

## Environment And Config

Keep environment config simple, typed, and centralized. Prefer uppercase env keys, explicit defaults, and computed getters for derived runtime flags:

```ts
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT) || 3000,
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  get isDev() {
    return this.NODE_ENV === "development"
  },
  get isTest() {
    return this.NODE_ENV === "test" || process.env.VITEST === "true"
  },
} as const
```

A plain config object is enough for small surfaces. Use runtime schema validation when the surface area is large, missing values cause hard-to-debug failures, values cross package boundaries, or the framework expects validated config. Do not add a full env validation layer for a handful of obvious variables.

## Seeders And Test Data

Seeders are backend infrastructure. Treat them as code, not throwaway scripts.

Good seeders:

- Have explicit table ordering when foreign keys or dependencies matter.
- Separate autoincrement tables from no-id/join tables when reset behavior differs.
- Convert serialized JSON values back into runtime types such as `Date`.
- Provide `seed()` and `clear()` entrypoints.
- Support seeding a subset of tables/files for focused tests.
- Keep database-specific reset behavior in the seeder, not in every test.

Be careful with silent fallbacks. Returning an empty seed when a file is missing can be convenient, but it should be a deliberate test-data policy, not accidental error hiding.

## Comments And Documentation

Comments should explain intent, invariants, sequencing, security, and outside-world behavior.

Use JSDoc for:

- Public services, repositories, factories, modules, and complex helpers.
- Public methods with non-obvious sequencing or failure semantics.
- Security-sensitive code.
- External-system behavior.
- Database transitions and consistency rules.

Use inline comments sparingly for:

- Tricky parsing, fake URLs, auth/session behavior, provider wiring, fallbacks, temporary workarounds, and intentional hacks.
- Why the order matters.
- Why an operation is intentionally non-blocking.
- Why a fallback is safe.
- Why a surprising branch exists.

Avoid comments that restate code.

Good:

```ts
/**
 * Rotate the token by updating the external provider before storing the new hash.
 * If the provider update fails, the old token remains valid locally.
 */
async rotateToken(id: string) {
  // External provider is source of truth for live auth, so update it first.
}
```

Bad:

```ts
// Set the name field to the name from the input.
user.name = input.name
```

## Error Handling

Use guard clauses to reject invalid conditions before the happy path. Add local `try`/`catch` only when the current layer owns a recovery policy; otherwise let the error reach the existing boundary.

Expected domain outcomes should be explicit:

- Return `null` when absence is normal.
- Return typed result/status objects when callers need to branch.
- Use discriminated `{ ok: true; data } | { ok: false; error }` results for external operations with expected failure modes.
- Use DTO status fields for durable workflow state.
- Map expected failures to transport errors at the route/controller boundary.

Throw for:

- Programmer errors.
- Impossible states.
- Failed infrastructure or external-system operations that the caller should not treat as ordinary absence.
- Persistence failures where continuing would corrupt state.

Do not bury expected business outcomes in generic exceptions when a typed return is clearer.

Use tolerant parsing only for intentionally partial, best-effort list surfaces where dropping invalid items is a product decision and the failure is logged with enough context. For canonical database reads, admin views, security-sensitive data, and durable contracts, fail loudly instead of hiding malformed data.
At transport, action, or controller boundaries, use a shared `getErrorMessage`-style utility for converting unknown errors into user-facing messages. Preserve explicit framework/domain errors rather than wrapping them into generic messages.

## Logging And Observability

Logger consistency is a sign of a maintained backend. Use the project's logger package or global logger pattern. If none exists, suggest one before inventing local logging styles.

Guidelines:

- Prefer injectable or shared loggers so services inherit request/module context.
- Use `trace` and `debug` for detailed workflow steps.
- Use `info` minimally for lifecycle events and important state changes.
- Use `warn` for recoverable unexpected situations.
- Use `error` for failed operations that need attention.
- Include useful IDs and context, not raw secrets or large request bodies.
- Let log level decide verbosity. Do not remove useful debug/trace logs just to keep implementation quiet.

## Testing

Use test-assisted development by default:

- Add or update tests as part of backend changes.
- Go test-first for bugs, regressions, risky branching, contracts, security, crypto, auth/guards, and persistence transitions.
- For exploratory work where the implementation shape is still moving, avoid freezing tests around churn. Once the shape settles, add or update behavior tests for the final branches, contracts, and failure modes.
- Do not test what TypeScript already guarantees.
- Test observable behavior through the stable boundary that owns it. Do not test one-line helpers or incidental implementation order.

Default backend test layout:

```text
tests/
  unit/
  integration/
  helpers/
  seed/
  __snapshots__/
```

Adapt to the repo if it already uses co-located tests or another clear convention.

Test choices:

- Unit-test pure helpers, guards, crypto, validation, and service logic with fake dependencies.
- Integration-test routes with the framework's injection/test client, including ACL, delegation, DTO parsing, and error mapping.
- Test service orchestrators through trusted inputs and observable outputs; assert operation order only when sequencing is part of the contract.
- Repository-test persistence behavior with seed data and real DTO parsing.
- Use snapshots only for stable response, DTO, and error contracts.
- Normalize generated IDs, timestamps, random values, and external values with explicit matchers.
- Keep nested `describe` blocks shallow unless the repo has a different convention.

Test mock patterns:

- Build context factories (`fakeCtx()`, `fakeRequest()`, `createTestApp()`) that return typed test doubles with sensible defaults. Let each test override only the parts it cares about.
- Prefer constructor-injected mock clients for SDKs and services that already support DI.
- Use module-level mocks only when the codebase already uses them or when constructor injection would distort production code.
- Keep mock state minimal and reset between tests.
- Use table-driven tests (`it.each` or a small helper) for pure functions with many input/output pairs.

## Do And Don't

Do:

- Choose the app's boundaries early and follow them consistently across use cases.
- Keep controllers flat: resolve request state and guards, delegate trusted input, then parse the public DTO.
- Keep services focused on their inputs, outputs, durable business rules, and named domain operations.
- Use classes, dependency injection, and factories when they clarify ownership, lifecycle, or construction.
- Push ugly mechanics downward behind deep, intention-revealing interfaces.

Don't:

- Treat classes, inheritance, dependency injection, or factories as the architecture itself.
- Create controller, service, repository, or helper chains that only forward calls.
- Pass transport authentication or request state into reusable services, or return public DTOs from them.
- Bury the normal flow under nested branches or local `try`/`catch` blocks without a recovery responsibility.
- Let individual use cases bypass or reinvent the app's chosen onion.

## Review Checklist

When reviewing backend code, check:

- Are transport, workflow, persistence, and external-system responsibilities separated, with the normal path visible at the controller and service boundaries?
- Do controllers own caller state, ACL, request/response parsing, and transport mapping?
- Do services receive trusted inputs and own reusable operations, durable business rules, and workflow sequencing?
- Are guards composable, wired at the route boundary, and fail-closed?
- Are durable contracts centralized and endpoint-local schemas kept local?
- Is there one contract source of truth, or are shapes duplicated by hand?
- Are generated files clearly marked and derived from hand-written sources?
- Are repositories rich enough and limited to database side effects?
- Are external systems wrapped in services/adapters with discriminated result types?
- Are generated/protocol clients hidden behind app-owned facades?
- Are plugins registered in dependency order with explicit declarations?
- Are registries/factories useful and tested, or just abstract for their own sake?
- Are names domain-specific and files placed where future readers will look?
- Is logging contextual, level-driven, and consistent with the project?
- Are expected failures explicit and unexpected failures allowed to surface?
- Are tests covering behavior, contracts, persistence transitions, and risky branches?
- Do tests use context factories for mock construction instead of ad-hoc object literals?
