import {
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
    Context,
  } from "aws-lambda";
import { ApiGatewayManagementApi, SQS } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";
import { v4 as uuid } from "uuid";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

const wsApiEndpoint = process.env.WSAPI_ENDPOINT!.substring(6);
const actionQueueUrl = process.env.ACTION_QUEUE_URL!;

const apiGatewayManagementApi = new ApiGatewayManagementApi({
  endpoint: wsApiEndpoint
});

const sqsClient = new SQS();

// Lambda function responsável pela gestão de dados do WebSocket
export async function handler(
    event: APIGatewayProxyEvent,
    context: Context
  ): Promise<APIGatewayProxyResult> {
    // TODO - to be removed
    console.log(`Event: ${JSON.stringify(event)}`);

    const lambdaRequestId = context.awsRequestId;
    const connectionId = event.requestContext.connectionId!;
    const email = JSON.parse(event.body!).email as string;
    const action = JSON.parse(event.body!).action as string;

    console.log(`Email: ${email} - ConnectionId: ${connectionId} - Lambda requestId: ${lambdaRequestId}`);

    const transactionId = uuid();

    await sqsClient.sendMessage({
      QueueUrl: actionQueueUrl,
      MessageBody: JSON.stringify({
        action,
        email,
        transactionId,
        connectionId,
        lambdaRequestId
      })
    }).promise();

    const postData = JSON.stringify({
      email,
      transactionId,
      status: "RECEIVED"
    });

    await apiGatewayManagementApi.postToConnection({
      ConnectionId: connectionId,
      Data: postData
    }).promise();
    
    return {
        statusCode: 200,
        body: "OK",
      };
  }