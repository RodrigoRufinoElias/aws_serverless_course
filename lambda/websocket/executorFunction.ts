import { SQSEvent, Context } from "aws-lambda";
import { ApiGatewayManagementApi, SQS } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

const wsApiEndpoint = process.env.WSAPI_ENDPOINT!.substring(6);

const apiGatewayManagementApi = new ApiGatewayManagementApi({
  endpoint: wsApiEndpoint,
});

export async function handler(
  event: SQSEvent,
  context: Context
): Promise<void> {
  const promises: Promise<void>[] = [];

  event.Records.forEach((record) => {
    const body = JSON.parse(record.body!);
    const email = body.email as string;
    const transactionId = body.transactionId as string;
    const connectionId = body.connectionId as string;

    promises.push(executeAction(email, transactionId, connectionId));
  });

  await Promise.all(promises);

  return;
}

async function executeAction(
  email: string,
  transactionId: string,
  connectionId: string
): Promise<void> {
  try {
    // Verifica se a conexão ainda está ativa
    await apiGatewayManagementApi
      .getConnection({
        ConnectionId: connectionId,
      })
      .promise();

    const postData = JSON.stringify({
      email,
      transactionId,
      status: "EXECUTED",
    });

    await apiGatewayManagementApi
      .postToConnection({
        ConnectionId: connectionId,
        Data: postData,
      })
      .promise();

    // Desconecta o cliente do WebSocket
    await apiGatewayManagementApi
      .deleteConnection({
        ConnectionId: connectionId,
      })
      .promise();
  } catch (error) {
    console.error(error);
  }
}
