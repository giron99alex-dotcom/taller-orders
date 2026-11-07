import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";

type HttpHandler = (
  event: APIGatewayProxyEvent
) => Promise<APIGatewayProxyResult>;

const ALLOWED_HEADERS =
  "Content-Type, Authorization, X-Api-Key, X-Amz-Date, X-Amz-Security-Token";
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const MANAGED_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "vary",
]);

// API Gateway usa headers; las llamadas internas entre Lambdas pueden omitirlos.
export function withCORS(handler: HttpHandler): HttpHandler {
  return async (event) => {
    const origin = Object.entries(event.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "origin"
    )?.[1];

    const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    const result: APIGatewayProxyResult =
      event.httpMethod?.toUpperCase() === "OPTIONS"
        ? { statusCode: 204, body: "" }
        : await handler(event);

    // Quitamos valores CORS anteriores para no conservar un comodin por error.
    const headers = Object.fromEntries(
      Object.entries(result.headers ?? {}).filter(
        ([name]) => !MANAGED_HEADERS.has(name.toLowerCase())
      )
    );
    const multiValueHeaders = Object.fromEntries(
      Object.entries(result.multiValueHeaders ?? {}).filter(
        ([name]) => !MANAGED_HEADERS.has(name.toLowerCase())
      )
    );

    const previousVary = [
      ...Object.entries(result.headers ?? {})
        .filter(([name]) => name.toLowerCase() === "vary")
        .map(([, value]) => String(value)),
      ...Object.entries(result.multiValueHeaders ?? {})
        .filter(([name]) => name.toLowerCase() === "vary")
        .flatMap(([, values]) => values.map(String)),
    ];
    const vary = previousVary
      .join(",")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!vary.some((value) => value.toLowerCase() === "origin")) {
      vary.push("Origin");
    }

    headers["Vary"] = vary.join(", ");
    headers["Access-Control-Allow-Headers"] = ALLOWED_HEADERS;
    headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS;

    if (origin && allowedOrigins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    } else if (origin && allowedOrigins.includes("*")) {
      headers["Access-Control-Allow-Origin"] = "*";
    }

    return {
      ...result,
      headers,
      ...(result.multiValueHeaders ? { multiValueHeaders } : {}),
    };
  };
}
