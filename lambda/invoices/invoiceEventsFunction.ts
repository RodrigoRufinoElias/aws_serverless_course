import * as AWSXRay from "aws-xray-sdk";
import { Context, DynamoDBStreamEvent, AttributeValue } from "aws-lambda";
import { DynamoDB, ApiGatewayManagementApi, EventBridge } from "aws-sdk";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome das tabela através do env
const eventsDdb = process.env.EVENTS_DDB!;
const invoicesWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);
const auditBusName = process.env.AUDIT_BUS_NAME!;

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

// Inicia client do ApiGatewayManagementApi
const apiGwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWsApiEndpoint,
});

// Inicia Invoice WS Service
const invoiceWSService = new InvoiceWSService(apiGwManagementApi);

// Inicia o client do EventBridge
const eventBridgeClient = new EventBridge();

// Lambda function responsável pelos eventos da tabela invoices
export async function handler(
  event: DynamoDBStreamEvent,
  context: Context
): Promise<void> {
  const promises: Promise<void>[] = [];

  event.Records.forEach((record) => {
    if (record.eventName === "INSERT") {
      if (record.dynamodb!.NewImage!.pk.S!.startsWith("#transaction")) {
        console.log("Invoice transaction event received");
      } else {
        console.log("Invoice event received");
        promises.push(
          createEvent(record.dynamodb!.NewImage!, "INVOICE_CREATED")
        );
      }
    } else if (record.eventName === "REMOVE") {
      if (record.dynamodb!.OldImage!.pk.S === "#transaction") {
        console.log("Invoice transaction event received");
        promises.push(processExpiredTransaction(record.dynamodb!.OldImage!));
      }
    }
  });

  await Promise.all(promises);

  return;
}

async function createEvent(
  invoiceImage: { [key: string]: AttributeValue },
  eventType: string
): Promise<void> {
  const timestamp = Date.now();
  const ttl = ~~(timestamp / 1000 + 60 * 2);

  await ddbClient
    .put({
      TableName: eventsDdb,
      Item: {
        pk: `#invoice_${invoiceImage.sk.S}`,
        sk: `${eventType}#${timestamp}`,
        ttl: ttl,
        email: invoiceImage.pk.S!.split("_")[1],
        createdAt: timestamp,
        eventType: eventType,
        info: {
          transaction: invoiceImage.transactionId.S,
          productId: invoiceImage.productId.S,
          quantity: invoiceImage.quantity.N,
        },
      },
    })
    .promise();

  return;
}

async function processExpiredTransaction(invoiceTransactionImage: {
  [key: string]: AttributeValue;
}): Promise<void> {
  const transactionId = invoiceTransactionImage.sk.S!;
  const connectionId = invoiceTransactionImage.connectionId.S!;
  const transactionStatus = invoiceTransactionImage.transactionStatus.S!;

  console.log(
    `ConnectionId: ${connectionId} - TransactionId: ${transactionId}`
  );

  if (transactionStatus === "INVOICE_PROCESSED") {
    console.log("Invoice processed");
  } else {
    console.log(`Invoice import failed - Status: ${transactionStatus}`);

    // Publica evento no Event Bridge
    const putEventPromise = eventBridgeClient
      .putEvents({
        Entries: [
          {
            Source: "app.invoice",
            EventBusName: auditBusName,
            DetailType: "invoice",
            Time: new Date(),
            Detail: JSON.stringify({
              errorDetail: "TIMEOUT",
              transactionId: transactionId,
            }),
          },
        ],
      })
      .promise();

    const sendStatusPromise = invoiceWSService.sendInvoiceStatus(
      transactionId,
      connectionId,
      "TIMEOUT"
    );

    await Promise.all([putEventPromise, sendStatusPromise]);

    await invoiceWSService.disconnectClient(connectionId);
  }

  return;
}
