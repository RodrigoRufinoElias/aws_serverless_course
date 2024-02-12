import { SQSEvent, Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Lambda function responsável pela gestão de pedidos
export async function handler(
  event: SQSEvent,
  context: Context
): Promise<void> {
  event.Records.forEach((record) => {
    console.log(record);
    const body = JSON.parse(record.body);
    console.log(body);
  });

  return;
}
