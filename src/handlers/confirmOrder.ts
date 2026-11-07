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

    if (callerRole !== "seller") {
      return forbidden(
        "Solo un vendedor con productos en esta orden puede confirmarla."
      );
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

    if (order.status !== "pending") {
      return badRequest(
        `No se puede confirmar una orden con estado ${order.status}.`
      );
    }

    const sellerProducts = await invokeLambda<{
      products: Array<{ productId: string }>;
    }>(productsFn("ListBySeller"), {
      pathParameters: { sellerId: callerId },
    });

    if (
      sellerProducts.statusCode !== 200 ||
      !Array.isArray(sellerProducts.body?.products)
    ) {
      throw new Error("No se pudieron consultar los productos del vendedor.");
    }

    const sellerProductIds = new Set(
      sellerProducts.body.products.map((product) => product.productId)
    );

    const isSeller = order.items.some((item) =>
      sellerProductIds.has(item.productId)
    );

    if (!isSeller) {
      return forbidden(
        "Solo un vendedor con productos en esta orden puede confirmarla."
      );
    }

    const result = await dynamo.send(
      new UpdateCommand({
        TableName: ordersTable,
        Key: { orderId },
        UpdateExpression:
          "SET #status = :confirmed, updatedAt = :updatedAt",
        ConditionExpression:
          "attribute_exists(orderId) AND #status = :pending",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":confirmed": "confirmed",
          ":pending": "pending",
          ":updatedAt": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return ok({
      message: "Orden confirmada.",
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

    console.error("Error al confirmar la orden:", error);
    return internalError();
  }
};

export const confirmOrder = withCORS(handler);
