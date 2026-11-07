import { withCORS } from "../common/cors";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo } from "../lib/dynamo";
import { invokeLambda, productsFn } from "../lib/lambdaInvoke";
import {
  badRequest,
  created,
  internalError,
  unauthorized,
} from "../lib/responses";
import type { Order, OrderItem } from "../types/order";

interface ProductSnapshot {
  productId: string;
  name: string;
  price: number;
  stock: number;
}

async function fetchProduct(
  productId: string
): Promise<ProductSnapshot | null> {
  const result = await invokeLambda<{
    product?: ProductSnapshot;
    message?: string;
  }>(productsFn("Get"), {
    pathParameters: { id: productId },
  });

  if (result.statusCode === 404) {
    return null;
  }

  const product = result.body?.product;

  if (result.statusCode !== 200 || !product) {
    throw new Error(`No se pudo consultar el producto ${productId}.`);
  }

  return product;
}

async function decrementStock(
  productId: string,
  quantity: number,
  userId: string
): Promise<boolean> {
  try {
    const result = await invokeLambda<{ message?: string }>(
      productsFn("UpdateStock"),
      {
        pathParameters: { id: productId },
        requestContext: {
          authorizer: { userId },
        },
        body: JSON.stringify({ quantity }),
      }
    );

    if (result.statusCode !== 200) {
      console.error("Falló el descuento de stock:", {
        productId,
        statusCode: result.statusCode,
        message: result.body?.message,
      });

      return false;
    }

    return true;
  } catch (error) {
    console.error("Error al invocar UpdateStock:", error);
    return false;
  }
}

const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer?.userId;

    if (typeof userId !== "string" || !userId) {
      return unauthorized();
    }

    const ordersTable = process.env.ORDERS_TABLE;

    if (!ordersTable) {
      throw new Error("No está configurada la variable ORDERS_TABLE.");
    }

    let body: unknown;

    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return badRequest("El cuerpo debe contener un JSON válido.");
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return badRequest("Debes enviar un objeto JSON.");
    }

    const items = (body as Record<string, unknown>).items;

    if (!Array.isArray(items) || items.length === 0) {
      return badRequest("Debes enviar al menos un producto en items.");
    }

    const requestedItems = new Map<string, number>();

    for (const rawItem of items) {
      if (
        typeof rawItem !== "object" ||
        rawItem === null ||
        Array.isArray(rawItem)
      ) {
        return badRequest("Cada item debe ser un objeto JSON.");
      }

      const { productId, quantity } =
        rawItem as Record<string, unknown>;

      if (
        typeof productId !== "string" ||
        !productId.trim() ||
        typeof quantity !== "number" ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0
      ) {
        return badRequest(
          "Cada item requiere productId y una cantidad entera mayor a cero."
        );
      }

      const id = productId.trim();
      const totalQuantity = (requestedItems.get(id) ?? 0) + quantity;

      if (!Number.isSafeInteger(totalQuantity)) {
        return badRequest("La cantidad solicitada es demasiado grande.");
      }

      requestedItems.set(id, totalQuantity);
    }

    const resolvedItems: OrderItem[] = [];

    for (const [productId, quantity] of requestedItems) {
      const product = await fetchProduct(productId);

      if (!product) {
        return badRequest(`El producto ${productId} no existe.`);
      }

      if (product.stock < quantity) {
        return badRequest(
          `Stock insuficiente para ${product.name}. Disponibles: ${product.stock}.`
        );
      }

      resolvedItems.push({
        productId,
        quantity,
        price: product.price,
      });
    }

    const total = Math.round(
      resolvedItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      ) * 100
    ) / 100;

    if (!Number.isFinite(total)) {
      return badRequest("El total de la orden está fuera de rango.");
    }

    const now = new Date().toISOString();

    const order: Order = {
      orderId: uuidv4(),
      userId,
      items: resolvedItems,
      total,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    await dynamo.send(
      new PutCommand({
        TableName: ordersTable,
        Item: order,
        ConditionExpression: "attribute_not_exists(orderId)",
      })
    );

    for (const item of resolvedItems) {
      const success = await decrementStock(
        item.productId,
        item.quantity,
        userId
      );

      if (!success) {
        await dynamo.send(
          new UpdateCommand({
            TableName: ordersTable,
            Key: { orderId: order.orderId },
            UpdateExpression:
              "SET #status = :status, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":status": "canceled",
              ":updatedAt": new Date().toISOString(),
            },
          })
        );

        return badRequest(
          "No se pudo reservar el stock. La orden fue cancelada."
        );
      }
    }

    return created({
      message: "Orden creada.",
      order,
    });
  } catch (error) {
    console.error("Error al crear la orden:", error);
    return internalError();
  }
};

export const createOrder = withCORS(handler);
