import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { DynamoDB, S3, ApiGatewayManagementApi } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";
import { v4 as uuid } from "uuid";
import {
  InvoiceTransactionStatus,
  InvoiceTransactionRepository,
} from "/opt/nodejs/invoiceTransaction";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome das tabela através do env
const invoiceDdb = process.env.INVOICE_DDB!;
const bucketName = process.env.BUCKET_NAME!;
const invoicesWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6);

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

// Lambda function responsável pela gestão de pedidos
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  // TODO Remove
  console.log(event);

  const lambdaRequestId = context.awsRequestId;
  const connectionId = event.requestContext.connectionId!;

  console.log(
    `ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`
  );

  const key = uuid();
  const expires = 300;

  // Gerar URL assinada pra ação "putObject"
  const signedUrlPut = await s3Client.getSignedUrlPromise("putObject", {
    Bucket: bucketName,
    Key: key,
    // tempo de expiração da URL em segundos
    Expires: expires,
  });

  // Criação do Invoice Transaction
  const timestamp = Date.now();
  const ttl = ~~(timestamp / 1000 + 60 * 2);

  await invoiceTransactionRepository.createInvoiceTransaction({
    pk: "#transaction",
    sk: key,
    ttl: ttl,
    requestId: lambdaRequestId,
    transactionStatus: InvoiceTransactionStatus.GENERATED,
    timestamp: timestamp,
    expiresIn: expires,
    connectionId: connectionId,
    endpoint: invoicesWsApiEndpoint,
  });

  // Envia a URL pro cliente WS conectado
  const postData = JSON.stringify({
    url: signedUrlPut,
    expires: expires,
    transactionId: key,
  });

  await invoiceWSService.sendData(connectionId, postData);

  return {
    statusCode: 200,
    body: "OK",
  };
}
