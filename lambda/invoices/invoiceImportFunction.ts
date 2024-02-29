import * as AWSXRay from "aws-xray-sdk";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Lambda function responsável pela importação de invoices
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  console.log(event);

  return {
    statusCode: 200,
    body: "OK",
  };
}