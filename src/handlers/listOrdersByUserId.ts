import { withCORS } from "../common/cors";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import {
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../lib/dynamo";
import {
  badRequest,
  forbidden,
  internalError,
  ok,
  unauthorized,
} from "../lib/responses";
import type { Order } from "../types/order";

const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.pathParameters?.userId;
    const callerId = event.requestContext.authorizer?.userId;

    if (typeof callerId !== "string" || !callerId) {
      return unauthorized();
    }

    if (!userId) {
      return badRequest("Falta el ID del usuario.");
    }

    if (userId !== callerId) {
      return forbidden("Solo puedes listar tus propias órdenes.");
    }

    const ordersTable = process.env.ORDERS_TABLE;

    if (!ordersTable) {
      throw new Error("No está configurada la variable ORDERS_TABLE.");
    }

    const orders: Order[] = [];
    let lastKey: QueryCommandInput["ExclusiveStartKey"];

    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: ordersTable,
          IndexName: "user-orders-index",
          KeyConditionExpression: "#userId = :userId",
          ExpressionAttributeNames: {
            "#userId": "userId",
          },
          ExpressionAttributeValues: {
            ":userId": userId,
          },
          ExclusiveStartKey: lastKey,
        })
      );

      orders.push(...((result.Items ?? []) as Order[]));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return ok({
      userId,
      orders,
    });
  } catch (error) {
    console.error("Error al listar las órdenes del usuario:", error);
    return internalError();
  }
};

export const listOrdersByUserId = withCORS(handler);
