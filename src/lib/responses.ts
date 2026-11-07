import type { APIGatewayProxyResult } from "aws-lambda";

function response(
  statusCode: number,
  data: unknown
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  };
}

export const ok = (data: unknown) => response(200, data);

export const created = (data: unknown) => response(201, data);

export const badRequest = (message: string) =>
  response(400, { message });

export const unauthorized = (message = "No autorizado.") =>
  response(401, { message });

export const forbidden = (message: string) =>
  response(403, { message });

export const notFound = (message: string) =>
  response(404, { message });

export const internalError = () =>
  response(500, { message: "Ocurrió un error en el servidor." });