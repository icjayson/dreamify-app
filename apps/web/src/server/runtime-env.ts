import { z } from "zod";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const PUBLIC_PLACEHOLDER_MARKERS = [
  "replace-with",
  "change-me",
  "changeme",
  "example.com",
  "example.test",
  "your-",
  "<",
  ">",
] as const;

function isPublicPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    PUBLIC_PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
  );
}

function isHostedHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !localHostnames.has(url.hostname) &&
      !isPublicPlaceholder(url.hostname)
    );
  } catch {
    return false;
  }
}

const hostedOrigin = z
  .string()
  .trim()
  .refine(
    isHostedHttpsOrigin,
    "must be a non-placeholder HTTPS origin without credentials, path, query, or hash",
  );

const sharedSecret = z
  .string()
  .trim()
  .min(32, "must contain at least 32 characters")
  .refine((value) => !isPublicPlaceholder(value), "must not be a public placeholder");

const optionalCredential = z.string().trim().optional();

export const hostedWebEnvironmentSchema = z
  .object({
    NODE_ENV: z.literal("production"),
    VERCEL: z.literal("1"),
    VERCEL_ENV: z.enum(["preview", "production"]),
    NEXT_PUBLIC_SITE_URL: hostedOrigin,
    NEXT_PUBLIC_API_URL: hostedOrigin,
    DREAMIFY_API_URL: hostedOrigin,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
      .string()
      .trim()
      .regex(/^pk_(?:test|live)_.{8,}$/, "must be a Clerk publishable key"),
    CLERK_SECRET_KEY: z
      .string()
      .trim()
      .regex(/^sk_(?:test|live)_.{8,}$/, "must be a Clerk secret key"),
    NEXT_PUBLIC_DEMO_AUTH_MODE: z.literal("false"),
    BLOB_PRIVATE_READ_WRITE_TOKEN: optionalCredential,
    BLOB_READ_WRITE_TOKEN: optionalCredential,
    BLOB_GATEWAY_SHARED_SECRET: sharedSecret,
    INTERNAL_SERVICE_SHARED_SECRET: sharedSecret,
    SANDBOX_SNAPSHOT_ID: z
      .string()
      .trim()
      .regex(/^snap_[A-Za-z0-9_-]{6,190}$/, "must be a Vercel Sandbox snapshot ID"),
  })
  .superRefine((environment, context) => {
    const blobToken =
      environment.BLOB_PRIVATE_READ_WRITE_TOKEN || environment.BLOB_READ_WRITE_TOKEN;
    if (
      !blobToken ||
      blobToken.length < 20 ||
      isPublicPlaceholder(blobToken)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BLOB_READ_WRITE_TOKEN"],
        message: "a non-placeholder private Blob read/write token is required",
      });
    }
    if (
      environment.BLOB_GATEWAY_SHARED_SECRET ===
      environment.INTERNAL_SERVICE_SHARED_SECRET
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTERNAL_SERVICE_SHARED_SECRET"],
        message: "must be generated independently from BLOB_GATEWAY_SHARED_SECRET",
      });
    }
    const publicClerkMode = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.split("_")[1];
    const secretClerkMode = environment.CLERK_SECRET_KEY.split("_")[1];
    if (publicClerkMode !== secretClerkMode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLERK_SECRET_KEY"],
        message: "must use the same Clerk instance mode as the publishable key",
      });
    }
    if (
      new URL(environment.NEXT_PUBLIC_API_URL).origin !==
      new URL(environment.DREAMIFY_API_URL).origin
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DREAMIFY_API_URL"],
        message: "must identify the same API origin as NEXT_PUBLIC_API_URL",
      });
    }
  });

export class HostedWebEnvironmentError extends Error {
  readonly code = "WEB_ENV_INVALID";

  constructor(issues: readonly string[]) {
    super(`WEB_ENV_INVALID: Hosted web environment is invalid: ${issues.join("; ")}`);
    this.name = "HostedWebEnvironmentError";
  }
}

export function isHostedWebEnvironment(environment: RuntimeEnvironment): boolean {
  return (
    environment.VERCEL_ENV === "preview" ||
    environment.VERCEL_ENV === "production" ||
    (environment.VERCEL === "1" && environment.VERCEL_ENV !== "development")
  );
}

export function assertHostedWebEnvironment(
  environment: RuntimeEnvironment = process.env,
): void {
  if (!isHostedWebEnvironment(environment)) return;

  const parsed = hostedWebEnvironmentSchema.safeParse(environment);
  if (parsed.success) return;

  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.join(".") || "environment";
    return `${path}: ${issue.message}`;
  });
  throw new HostedWebEnvironmentError(issues);
}
