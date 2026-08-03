"use client";

import NextLink from "next/link";
import {
  usePathname,
  useRouter,
  useSearchParams as useNextSearchParams,
} from "next/navigation";
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

type RouteParams = Record<string, string | undefined>;
type SearchParamsInput =
  | string
  | URLSearchParams
  | Array<[string, string]>
  | Record<string, string | string[]>;

interface NavigationOptions {
  replace?: boolean;
  state?: unknown;
}

interface RouteProps {
  path: string;
  element: ReactNode;
}

const ParamsContext = createContext<RouteParams>({});

function normalizedSegments(path: string) {
  const normalized = path === "/" ? "" : path.replace(/^\/+|\/+$/g, "");
  return normalized ? normalized.split("/") : [];
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function matchRoutePattern(pattern: string, pathname: string): RouteParams | null {
  if (pattern === "*") return {};

  const patternSegments = normalizedSegments(pattern);
  const pathSegments = normalizedSegments(pathname);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: RouteParams = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index];
    const actual = pathSegments[index];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = safeDecode(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function toSearchParams(input: SearchParamsInput) {
  if (typeof input === "string" || input instanceof URLSearchParams || Array.isArray(input)) {
    return new URLSearchParams(input);
  }

  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => params.append(key, item));
  });
  return params;
}

function hrefFrom(to: LinkProps["to"]) {
  if (typeof to === "string") return to;
  return `${to.pathname ?? ""}${to.search ?? ""}${to.hash ?? ""}` || "/";
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  return children;
}

export function Route(_props: RouteProps) {
  return null;
}

export function Routes({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";

  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue;
    const params = matchRoutePattern(child.props.path, pathname);
    if (params) {
      return <ParamsContext.Provider value={params}>{child.props.element}</ParamsContext.Provider>;
    }
  }
  return null;
}

export function useParams<T extends RouteParams = RouteParams>() {
  return useContext(ParamsContext) as T;
}

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string | number, options: NavigationOptions = {}) => {
      if (typeof to === "number") {
        if (to === -1) router.back();
        else window.history.go(to);
        return;
      }
      if (options.replace) router.replace(to);
      else router.push(to);
    },
    [router],
  );
}

export function useLocation() {
  const pathname = usePathname() || "/";
  const searchParams = useNextSearchParams();
  const query = searchParams.toString();
  return useMemo(
    () => ({
      pathname,
      search: query ? `?${query}` : "",
      hash: typeof window === "undefined" ? "" : window.location.hash,
      state: null as unknown,
      key: pathname,
    }),
    [pathname, query],
  );
}

export function useSearchParams(): [
  URLSearchParams,
  (
    next: SearchParamsInput | ((previous: URLSearchParams) => SearchParamsInput),
    options?: Pick<NavigationOptions, "replace">,
  ) => void,
] {
  const pathname = usePathname() || "/";
  const current = useNextSearchParams();
  const router = useRouter();
  const serialized = current.toString();
  const setSearchParams = useCallback(
    (
      next: SearchParamsInput | ((previous: URLSearchParams) => SearchParamsInput),
      options: Pick<NavigationOptions, "replace"> = {},
    ) => {
      const previous = new URLSearchParams(serialized);
      const resolved = typeof next === "function" ? next(previous) : next;
      const query = toSearchParams(resolved).toString();
      const href = query ? `${pathname}?${query}` : pathname;
      if (options.replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [pathname, router, serialized],
  );
  const readable = useMemo(() => new URLSearchParams(serialized), [serialized]);
  return [readable, setSearchParams];
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string | { pathname?: string; search?: string; hash?: string };
  replace?: boolean;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, children, ...props },
  ref,
) {
  return (
    <NextLink ref={ref} href={hrefFrom(to)} replace={replace} {...props}>
      {children}
    </NextLink>
  );
});

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, replace, to]);
  return null;
}
