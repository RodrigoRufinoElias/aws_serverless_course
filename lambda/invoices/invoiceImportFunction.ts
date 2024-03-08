import * as AWSXRay from "aws-xray-sdk";
import { Context, S3Event, S3EventRecord } from "aws-lambda";
import { DynamoDB, S3, ApiGatewayManagementApi, EventBridge } from "aws-sdk";
import {
  InvoiceTransactionRepository,
  InvoiceTransactionStatus,
} from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";
import { InvoiceFile, InvoiceRepository } from "/opt/nodejs/invoiceRepository";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome das tabela através do env
const invoiceDdb = process.env.INVOICE_DDB!;
const invoicesWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);
const auditBusName = process.env.AUDIT_BUS_NAME!;

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

// Inicia client do S3
const s3Client = new S3();

// Inicia client do ApiGatewayManagementApi
const apiGwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWsApiEndpoint,
});

// Inicia Invoice Repository
const invoiceTransactionRepository = new InvoiceTransactionRepository(
  ddbClient,
  invoiceDdb
);

// Inicia Invoice WS Service
const invoiceWSService = new InvoiceWSService(apiGwManagementApi);

// Inicia Invoice Repository
const invoiceRepository = new InvoiceRepository(ddbClient, invoiceDdb);

// Inicia o client do EventBridge
const eventBridgeClient = new EventBridge();

// Lambda function responsável pela importação de invoices
export async function handler(event: S3Event, context: Context): Promise<void> {
  const promises: Promise<void>[] = [];

  event.Records.forEach((record) => {
    promises.push(processRecord(record));
  });

  await Promise.all(promises);

  return;
}

async function processRecord(record: S3EventRecord): Promise<void> {
  const key = record.s3.object.key;

  try {
    const invoiceTransaction =
      await invoiceTransactionRepository.getInvoiceTransaction(key);

    if (
      invoiceTransaction.transactionStatus ===
      InvoiceTransactionStatus.GENERATED
    ) {
      await Promise.all([
        invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.RECEIVED
        ),
        invoiceTransactionRepository.updateInvoiceTransaction(
          key,
          InvoiceTransactionStatus.RECEIVED
        ),
      ]);
    } else {
      await invoiceWSService.sendInvoiceStatus(
        key,
        invoiceTransaction.connectionId,
        invoiceTransaction.transactionStatus
      );
      console.error("Non valid transaction status");
      return;
    }

    // Recupera arquivo do bucket S3
    const object = await s3Client
      .getObject({
        Key: key,
        Bucket: record.s3.bucket.name,
      })
      .promise();

    const invoice = JSON.parse(object.Body!.toString("utf-8")) as InvoiceFile;

    const createInvoicePromise = invoiceRepository.create({
      pk: `#invoice_${invoice.customerName}`,
      sk: invoice.invoiceNumber,
      // Quando o ttl é zero o dynamo não apaga o item
      ttl: 0,
      totalValue: invoice.totalValue,
      productId: invoice.productId,
      quantity: invoice.quantity,
      transactionId: key,
      createdAt: Date.now(),
    });

    // Deleta o objeto do bucket
    const deleteObjectPromise = s3Client
      .deleteObject({
        Key: key,
        Bucket: record.s3.bucket.name,
      })
      .promise();

    const updateInvoicePromise =
      invoiceTransactionRepository.updateInvoiceTransaction(
        key,
        InvoiceTransactionStatus.PROCESSED
      );

    const sendStatusPromise = invoiceWSService.sendInvoiceStatus(
      key,
      invoiceTransaction.connectionId,
      InvoiceTransactionStatus.PROCESSED
    );

    await Promise.all([
      createInvoicePromise,
      deleteObjectPromise,
      updateInvoicePromise,
      sendStatusPromise,
    ]);
  } catch (error) {
    // Publica evento no Event Bridge
    const result = await eventBridgeClient
      .putEvents({
        Entries: [
          {
            Source: "app.invoice",
            EventBusName: auditBusName,
            DetailType: "invoice",
            Time: new Date(),
            Detail: JSON.stringify({
              errorDetail: "FAIL_NO_INVOICE_NUMBER",
              info: {
                invoiceKey: key,
              },
            }),
          },
        ],
      })
      .promise();

    console.log((<Error>error).message);
  }
}
