import {
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";

const lambdaClient = new LambdaClient({});
const stage = process.env.STAGE ?? "develop";

type ProductFunctionName =
  | "Get"
  | "UpdateStock"
  | "ListBySeller";

export const productsFn = (name: ProductFunctionName): string =>
  `taller-${stage}-Products-${name}`;

export interface InvokeResult<T> {
  statusCode: number;
  body: T;
}

export async function invokeLambda<T>(
  functionName: string,
  event: Record<string, unknown>
): Promise<InvokeResult<T>> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(event)),
    })
  );

  if (response.FunctionError) {
    throw new Error(
      `Falló la Lambda ${functionName}: ${response.FunctionError}`
    );
  }

  if (!response.Payload?.length) {
    throw new Error(`La Lambda ${functionName} no devolvió una respuesta.`);
  }

  const raw: unknown = JSON.parse(
    Buffer.from(response.Payload).toString("utf8")
  );

  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    throw new Error(`Respuesta inválida de ${functionName}.`);
  }

  const result = raw as Record<string, unknown>;

  if (
    typeof result.statusCode !== "number" ||
    typeof result.body !== "string"
  ) {
    throw new Error(`Formato de respuesta incorrecto en ${functionName}.`);
  }

  return {
    statusCode: result.statusCode,
    body: JSON.parse(result.body) as T,
  };
}