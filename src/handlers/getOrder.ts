import { withCORS } from "../common/cors";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../lib/dynamo";
import {
  forbidden,
  internalError,
  notFound,
  ok,
  unauthorized,
} from "../lib/responses";

const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const orderId = event.pathParameters?.id;
    const callerId = event.requestContext.authorizer?.userId;

    if (!orderId) {
      return notFound("Orden no encontrada.");
    }

    if (typeof callerId !== "string" || !callerId) {
      return unauthorized();
    }

    const ordersTable = process.env.ORDERS_TABLE;

    if (!ordersTable) {
      throw new Error("No está configurada la variable ORDERS_TABLE.");
    }

    const result = await dynamo.send(
      new GetCommand({
        TableName: ordersTable,
        Key: { orderId },
        ConsistentRead: true,
      })
    );

    if (!result.Item) {
      return notFound("Orden no encontrada.");
    }

    if (result.Item.userId !== callerId) {
      return forbidden("Solo puedes consultar tus propias órdenes.");
    }

    return ok({
      message: "Orden encontrada.",
      order: result.Item,
    });
  } catch (error) {
    console.error("Error al obtener la orden:", error);
    return internalError();
  }
};

export const getOrder = withCORS(handler);
