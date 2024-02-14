import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

// Lambda function responsável pela disconexão com o WebSocket
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  // TODO - to be removed
  console.log(`Event: ${JSON.stringify(event)}`);

  return {
    statusCode: 200,
    body: "OK",
  };
}
