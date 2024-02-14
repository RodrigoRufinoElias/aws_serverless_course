import { Callback, Context } from "aws-lambda";
import { ProductEvent } from "/opt/nodejs/productEventsLayer";
import { DynamoDB } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome da tabela através do env
const eventsDdb = process.env.EVENTS_DDB!;

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

export async function handler(
  event: ProductEvent,
  context: Context,
  callback: Callback
): Promise<void> {
  // TODO - Remover depois
  console.log(event);

  console.log(`Lambda requestId: ${context.awsRequestId}`);

  await createEvent(event);

  callback(
    null,
    JSON.stringify({
      productEventCreated: true,
      message: "OK",
    })
  );
}

function createEvent(event: ProductEvent) {
  const timestamp = Date.now();
  // Monta o Time to live usando o timestamp em segundos (timestamp / 1000)
  // mais 5 minutos (5 * 60s). ~~ => Arredondar
  const ttl = ~~(timestamp / 1000) + 5 * 60;

  return ddbClient
    .put({
      TableName: eventsDdb,
      Item: {
        pk: `#product_${event.productCode}`,
        sk: `${event.eventType}#${timestamp}`,
        email: event.email,
        createdAt: timestamp,
        requestId: event.requestId,
        eventType: event.eventType,
        info: {
          productId: event.productId,
          price: event.productPrice,
        },
        ttl: ttl,
      },
    })
    .promise();
}
