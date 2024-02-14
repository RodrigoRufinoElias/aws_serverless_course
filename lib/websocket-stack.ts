import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as apigw2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigw2Integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { Construct } from "constructs";

export class WebSocketStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda para WebSocket Connection
    const connectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "ConnectionHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "ConnectionHandler",
        entry: "lambda/websocket/connectionHandler.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
      }
    );

    // Lambda para WebSocket Disconnection
    const disconnectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "DisconnectionHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "DisconnectionHandler",
        entry: "lambda/websocket/disconnectionHandler.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
      }
    );

    const websocketApi = new apigw2.WebSocketApi(this, "WSApi", {
      apiName: "WSApi",
      connectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration(
          "ConnectionHandler",
          connectionHandler
        ),
      },
      disconnectRouteOptions: {
        integration: new apigw2Integrations.WebSocketLambdaIntegration(
          "DisconnectionHandler",
          disconnectionHandler
        ),
      },
    });

    const stage = "prod";
    const wsApiEndpoint = `${websocketApi.apiEndpoint}/${stage}`;

    new apigw2.WebSocketStage(this, "WSApiStage", {
      webSocketApi: websocketApi,
      stageName: stage,
      autoDeploy: true,
    });

    // Monta Dead Letter Queue p/ travar a fila principal no caso de erros contínuos
    const actionDlq = new sqs.Queue(this, "ActionDlq", {
      queueName: "action-dlq",
    });

    // Monta Queue usando AWS SQS
    const actionSqs = new sqs.Queue(this, "ActionSqs", {
      queueName: "action-sqs",
      deadLetterQueue: {
        queue: actionDlq,
        maxReceiveCount: 3,
      },
    });

    // Lambda para WebSocket management
    const receiverHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "ReceiverHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "ReceiverFunction",
        entry: "lambda/websocket/receiverFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          WSAPI_ENDPOINT: wsApiEndpoint,
          ACTION_QUEUE_URL: actionSqs.queueUrl,
        },
      }
    );

    // Dá permissão ao "receiverHandler" para controlar a conexão
    websocketApi.grantManageConnections(receiverHandler);
    // Dá permissão ao "receiverHandler" para publicar mensagens na fila
    actionSqs.grantSendMessages(receiverHandler);

    websocketApi.addRoute("action1", {
      integration: new apigw2Integrations.WebSocketLambdaIntegration(
        "ReceiverHandler",
        receiverHandler
      ),
    });

    // Lambda para WebSocket response
    const executorHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "ExecutorHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "ExecutorFunction",
        entry: "lambda/websocket/executorFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );

    // Dá permissão ao "executorHandler" para controlar a conexão
    websocketApi.grantManageConnections(executorHandler);
    // Dá permissão ao "executorHandler" para publicar mensagens na fila
    actionSqs.grantConsumeMessages(executorHandler);

    executorHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(actionSqs, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(60),
        enabled: true,
      })
    );
  }
}
