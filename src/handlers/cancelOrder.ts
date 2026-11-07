import { withCORS } from "../common/cors";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { dynamo } from "../lib/dynamo";
import { invokeLambda, productsFn } from "../lib/lambdaInvoke";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  ok,
  unauthorized,
} from "../lib/responses";
import type { Order } from "../types/order";

const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const orderId = event.pathParameters?.id;
    const callerId = event.requestContext.authorizer?.userId;
    const callerRole = event.requestContext.authorizer?.role;

    if (typeof callerId !== "string" || !callerId) {
      return unauthorized();
    }

    if (!orderId) {
      return notFound("Orden no encontrada.");
    }

    const ordersTable = process.env.ORDERS_TABLE;

    if (!ordersTable) {
      throw new Error("No está configurada la variable ORDERS_TABLE.");
    }

    const existing = await dynamo.send(
      new GetCommand({
        TableName: ordersTable,
        Key: { orderId },
        ConsistentRead: true,
      })
    );

    if (!existing.Item) {
      return notFound("Orden no encontrada.");
    }

    const order = existing.Item as Order;
    const isBuyer = order.userId === callerId;
    let isSeller = false;

    if (!isBuyer && callerRole === "seller") {
      const sellerProducts = await invokeLambda<{
        products: Array<{ productId: string }>;
      }>(productsFn("ListBySeller"), {
        pathParameters: { sellerId: callerId },
      });

      if (
        sellerProducts.statusCode !== 200 ||
        !Array.isArray(sellerProducts.body?.products)
      ) {
        throw new Error(
          "No se pudieron consultar los productos del vendedor."
        );
      }

      const sellerProductIds = new Set(
        sellerProducts.body.products.map((product) => product.productId)
      );

      isSeller = order.items.some((item) =>
        sellerProductIds.has(item.productId)
      );
    }

    if (!isBuyer && !isSeller) {
      return forbidden(
        "Solo puedes cancelar tus propias órdenes o aquellas que contienen productos que vendes."
      );
    }

    if (order.status !== "pending") {
      return badRequest(
        `No se puede cancelar una orden con estado ${order.status}.`
      );
    }

    const result = await dynamo.send(
      new UpdateCommand({
        TableName: ordersTable,
        Key: { orderId },
        UpdateExpression:
          "SET #status = :canceled, updatedAt = :updatedAt",
        ConditionExpression:
          "attribute_exists(orderId) AND #status = :pending",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":canceled": "canceled",
          ":pending": "pending",
          ":updatedAt": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return ok({
      message: "Orden cancelada.",
      order: result.Attributes,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "ConditionalCheckFailedException"
    ) {
      return badRequest(
        "La orden ya no está pendiente. Consulta su estado actual."
      );
    }

    console.error("Error al cancelar la orden:", error);
    return internalError();
  }
};

export const cancelOrder = withCORS(handler);
