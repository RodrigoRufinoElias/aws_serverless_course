import * as cdk from "aws-cdk-lib";
import * as apigatewayv2 from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigatewayv2_integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSource from "aws-cdk-lib/aws-lambda-event-sources";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";

interface InvoiceWSApiStackProps extends cdk.StackProps {
  eventsDdb: dynamodb.Table;
  auditBus: events.EventBus;
}

export class InvoiceWSApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InvoiceWSApiStackProps) {
    super(scope, id, props);

    // Invoice Transaction Layer
    const invoiceTransactionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        "InvoiceTransactionLayerVersionArn"
      );
    const invoiceTransactionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceTransactionLayer",
      invoiceTransactionLayerArn
    );

    // Invoice Layer
    const invoiceLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "InvoiceRepositoryLayerVersionArn"
    );
    const invoiceLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceRepositoryLayer",
      invoiceLayerArn
    );

    // Invoice WS API Layer
    const invoiceWSConnectionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        "InvoiceWSConnectionLayerVersionArn"
      );
    const invoiceWSConnectionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "InvoiceWSConnectionLayer",
      invoiceWSConnectionLayerArn
    );

    // Função de gerenciamento da tabela INVOICEs
    const invoicesDdb = new dynamodb.Table(this, "InvoicesDdb", {
      tableName: "invoices",
      // Chave primária + secundária gerando chave composta
      // Chave primária
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING,
      },
      // Chave secundária
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: "ttl",
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Habilita o DynamoDB Stream (Invoca lambdas a partir de mudanças na tabela)
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Invoice bucket
    const bucket = new s3.Bucket(this, "InvoiceBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // Lambda para WS connection handler
    const connectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoiceConnectionFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoiceConnectionFunction",
        entry: "lambda/invoices/invoiceConnectionFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // Lambda para WS disconnection handler
    const disconnectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoiceDisconnectionFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoiceDisconnectionFunction",
        entry: "lambda/invoices/invoiceDisconnectionFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
      }
    );

    // WS API
    const websocketApi = new apigatewayv2.WebSocketApi(this, "InvoiceWSApi", {
      apiName: "InvoiceWSApi",
      connectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          "ConnectionHandler",
          connectionHandler
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
          "DisconnectionHandler",
          disconnectionHandler
        ),
      },
    });

    const stage = "prod";
    const wsApiEndpoint = `${websocketApi.apiEndpoint}/${stage}`;

    new apigatewayv2.WebSocketStage(this, "InvoiceWSApiStage", {
      webSocketApi: websocketApi,
      stageName: stage,
      autoDeploy: true,
    });

    // Lambda para Invoice URL handler
    const getUrlHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoiceGetUrlFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoiceGetUrlFunction",
        entry: "lambda/invoices/invoiceGetUrlFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          BUCKET_NAME: bucket.bucketName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );

    // Policy para permitir a escrita na tabela INVOICES
    const invoicesDdbWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#transaction"],
        },
      },
    });

    // Policy para permitir add objetos no bucket S3
    const invoicesBucketPutObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:PutObject"],
      resources: [`${bucket.bucketArn}/*`],
    });

    // Inclusão da policy "invoicesDdbWriteTransactionPolicy" nas roles do "getUrlHandler"
    getUrlHandler.addToRolePolicy(invoicesDdbWriteTransactionPolicy);
    // Inclusão da policy "invoicesBucketPutObjectPolicy" nas roles do "getUrlHandler"
    getUrlHandler.addToRolePolicy(invoicesBucketPutObjectPolicy);
    // Dá permissão ao "getUrlHandler" para controlar a conexão
    websocketApi.grantManageConnections(getUrlHandler);

    // Lambda para Invoice import handler
    const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoiceImportFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoiceImportFunction",
        entry: "lambda/invoices/invoiceImportFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [
          invoiceLayer,
          invoiceTransactionLayer,
          invoiceWSConnectionLayer,
        ],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
          AUDIT_BUS_NAME: props.auditBus.eventBusName,
        },
      }
    );

    // Dar ao "invoiceImportHandler" permissão de leitura e escrita na tabela "invoices".
    invoicesDdb.grantReadWriteData(invoiceImportHandler);

    // Ao criar um objeto no bucket do S3 com PUT é acionado a lambda "invoiceImportHandler"
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(invoiceImportHandler)
    );

    // Policy para permitir get e delete de objetos no bucket S3
    const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["s3:DeleteObject", "s3:GetObject"],
      resources: [`${bucket.bucketArn}/*`],
    });

    // Inclusão da policy "invoicesBucketGetDeleteObjectPolicy" nas roles do "invoiceImportHandler"
    invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy);

    // Dar ao "invoiceImportHandler" permissão para publicar eventos pelo Event Bridge "auditBus"
    props.auditBus.grantPutEventsTo(invoiceImportHandler);

    // Lambda para Cancel import handler
    const cancelImportHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "CancelImportFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "CancelImportFunction",
        entry: "lambda/invoices/cancelImportFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          INVOICE_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
      }
    );

    // Policy para permitir a atualização e recuperação de dados da tabela INVOICES
    const invoicesDdbReadWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:UpdateItem", "dynamodb:GetItem"],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#transaction"],
        },
      },
    });

    // Inclusão da policy "invoicesDdbReadWriteTransactionPolicy" nas roles do "cancelImportHandler"
    cancelImportHandler.addToRolePolicy(invoicesDdbReadWriteTransactionPolicy);
    // Dá permissão ao "cancelImportHandler" para controlar a conexão
    websocketApi.grantManageConnections(cancelImportHandler);

    // WS API routes
    websocketApi.addRoute("getImportUrl", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "GetUrlHandler",
        getUrlHandler
      ),
    });

    websocketApi.addRoute("cancelImport", {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration(
        "CancelImportHandler",
        cancelImportHandler
      ),
    });

    // Lambda para Invoice Events handler
    const invoiceEventsHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoiceEventsFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoiceEventsFunction",
        entry: "lambda/invoices/invoiceEventsFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        environment: {
          EVENTS_DDB: props.eventsDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
          AUDIT_BUS_NAME: props.auditBus.eventBusName,
        },
        layers: [invoiceWSConnectionLayer],
      }
    );

    // Criação de policy para permitir a ação PUT ITEM na tabela EVENTS
    // mas somente em valores que começam com #invoice_
    const eventsDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#invoice_*"],
        },
      },
    });

    // Inclusão da policy "eventsDdbPolicy" nas roles do "invoiceEventsHandler"
    invoiceEventsHandler.addToRolePolicy(eventsDdbPolicy);

    // Dá permissão ao "invoiceEventsHandler" para controlar a conexão
    websocketApi.grantManageConnections(invoiceEventsHandler);

    const invoiceEventsDlq = new sqs.Queue(this, "InvoiceEventsDlq", {
      queueName: "invoice-events-dlq",
    });

    invoiceEventsHandler.addEventSource(
      new lambdaEventSource.DynamoEventSource(invoicesDdb, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        onFailure: new lambdaEventSource.SqsDlq(invoiceEventsDlq),
        retryAttempts: 3,
      })
    );

    // Dar ao "invoiceEventsHandler" permissão para publicar
    // eventos pelo Event Bridge "auditBus"
    props.auditBus.grantPutEventsTo(invoiceEventsHandler);
  }
}
