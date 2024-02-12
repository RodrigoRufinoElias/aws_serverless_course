import { SNSEvent, Context } from "aws-lambda";

// Lambda function responsável pela gestão de pedidos
export async function handler(
  event: SNSEvent,
  context: Context
): Promise<void> {
  event.Records.forEach((record) => {
    console.log(record.Sns);
  });
}
