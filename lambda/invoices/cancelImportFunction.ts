import * as AWSXRay from "aws-xray-sdk";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { DynamoDB, ApiGatewayManagementApi } from "aws-sdk";
import {
  InvoiceTransactionRepository,
  InvoiceTransactionStatus,
} from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";
import { StringFilter } from "aws-sdk/clients/securityhub";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome das tabela através do env
const invoiceDdb = process.env.INVOICE_DDB!;
const invoicesWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

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

// Lambda function responsável pelo cancelamento da função de importação
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const transactionId = JSON.parse(event.body!).transactionId as string;
  const lambdaRequestId = context.awsRequestId;
  const connectionId = event.requestContext.connectionId!;

  console.log(
    `ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`
  );

  try {
    const invoiceTransaction =
      await invoiceTransactionRepository.getInvoiceTransaction(transactionId);

    if (
      invoiceTransaction.transactionStatus ===
      InvoiceTransactionStatus.GENERATED
    ) {
      await Promise.all([
        invoiceWSService.sendInvoiceStatus(
          transactionId,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.CANCELED
        ),
        invoiceTransactionRepository.updateInvoiceTransaction(
          transactionId,
          InvoiceTransactionStatus.CANCELED
        ),
      ]);
    } else {
      await invoiceWSService.sendInvoiceStatus(
        transactionId,
        connectionId,
        invoiceTransaction.transactionStatus
      );
      console.error(`Can't cancel an ongoing process`);
    }
  } catch (error) {
    console.log((<Error>error).message);
    console.error(`Invoice not found - Transaction ID: ${transactionId}`);
    await invoiceWSService.sendInvoiceStatus(
      transactionId,
      connectionId,
      InvoiceTransactionStatus.NOT_FOUND
    );
  }

  return {
    statusCode: 200,
    body: "OK",
  };
}
