import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = ["/", "/login"];

/**
 * Read-only routes a PUBLIC_DEMO deployment exposes without a session. Write
 * paths (settings, api-key management, and any POST — including server
 * actions, which post back to the current page) fall through to the normal
 * session check below.
 */
const PUBLIC_DEMO_GET_PATTERNS = [
  /^\/contracts$/,
  /^\/contracts\/\d+$/,
  /^\/contracts\/\d+\/transfers$/,
  /^\/events$/,
  /^\/transfers$/,
  /^\/api\/contracts\/\d+\/events$/
];

function isPublicDemoRequest(request: NextRequest): boolean {
  return (
    process.env.PUBLIC_DEMO === "true" &&
    request.method === "GET" &&
    PUBLIC_DEMO_GET_PATTERNS.some((pattern) => pattern.test(request.nextUrl.pathname))
  );
}

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.includes(request.nextUrl.pathname) || isPublicDemoRequest(request)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
