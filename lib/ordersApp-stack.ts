import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynadb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambdaEventSource from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";

interface OrdersAppStackProps extends cdk.StackProps {
  productsDdb: dynadb.Table;
  eventsDdb: dynadb.Table;
}

// Classe para gerenciar TODAS as funções lambda
// e integrações com DB relacionadas à classe ORDER
export class OrdersAppStack extends cdk.Stack {
  readonly ordersHandler: lambdaNodeJS.NodejsFunction;

  constructor(scope: Construct, id: string, props: OrdersAppStackProps) {
    super(scope, id, props);

    // Função de gerenciamento da tabela PRODUCTS
    const ordersDdb = new dynadb.Table(this, "OrdersDdb", {
      tableName: "orders",
      // Chave primária + secundária gerando chave composta
      // Chave primária
      partitionKey: {
        name: "pk",
        type: dynadb.AttributeType.STRING,
      },
      // Chave secundária
      sortKey: {
        name: "sk",
        type: dynadb.AttributeType.STRING,
      },
      billingMode: dynadb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
    });

    // Orders Layer
    const ordersLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "OrdersLayerVersionArn"
    );
    const ordersLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "OrdersLayerVersionArn",
      ordersLayerArn
    );

    // Orders API Layer
    const ordersApiLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "OrdersApiLayerVersionArn"
    );
    const ordersApiLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "OrdersApiLayerVersionArn",
      ordersApiLayerArn
    );

    // Order Events Layer
    const orderEventsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "OrderEventsLayerVersionArn"
    );
    const orderEventsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "OrderEventsLayerVersionArn",
      orderEventsLayerArn
    );

    // Order Events Repository Layer
    const orderEventsRepositoryLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        "OrderEventsRepositoryLayerVersionArn"
      );
    const orderEventsRepositoryLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "OrderEventsRepositoryLayerVersionArn",
      orderEventsRepositoryLayerArn
    );

    // Products Layer
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(
      this,
      "ProductsLayerVersionArn"
    );
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "ProductsLayerVersionArn",
      productsLayerArn
    );

    // Tópico SNS para ORDERS
    const ordersTopic = new sns.Topic(this, "OrderEventsTopic", {
      displayName: "Order events topic",
      topicName: "order-events",
    });

    // Lambda para ORDERS
    this.ordersHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "OrdersFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrdersFunction",
        entry: "lambda/orders/ordersFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // É necessário integrar o nome da tabela à função.
        // Posso usar qualquer nome para o env. Nesse caso,
        // usei EVENTS_DDB.
        environment: {
          PRODUCTS_DDB: props.productsDdb.tableName,
          ORDERS_DDB: ordersDdb.tableName,
          ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn,
        },
        layers: [ordersLayer, productsLayer, ordersApiLayer, orderEventsLayer],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Dar ao "ordersHandler" permissão de leitura
    // e escrita na tabela "orders".
    ordersDdb.grantReadWriteData(this.ordersHandler);
    // Dar ao "ordersHandler" permissão de leitura
    // na tabela "products".
    props.productsDdb.grantReadData(this.ordersHandler);

    // Dar ao "ordersHandler" permissão para publicar
    // tópicos pelo "ordersTopic"
    ordersTopic.grantPublish(this.ordersHandler);

    // Lambda para ORDER-EVENTS
    const orderEventsHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "OrderEventsFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrderEventsFunction",
        entry: "lambda/orders/orderEventsFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // É necessário integrar o nome da tabela à função.
        // Posso usar qualquer nome para o env. Nesse caso,
        // usei EVENTS_DDB.
        environment: {
          EVENTS_DDB: props.eventsDdb.tableName,
        },
        layers: [orderEventsLayer, orderEventsRepositoryLayer],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Inscrição do "orderEventsHandler" no tópico "ordersTopic"
    ordersTopic.addSubscription(
      new subs.LambdaSubscription(orderEventsHandler)
    );

    // Criação de policy para permitir a ação PUT ITEM na tabela EVENTS
    // mas somente em valores que começam com #order
    const eventsDdbPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:PutItem"],
      resources: [props.eventsDdb.tableArn],
      conditions: {
        ["ForAllValues:StringLike"]: {
          "dynamodb:LeadingKeys": ["#order_*"],
        },
      },
    });

    // Inclusão da policy "eventsDdbPolicy" nas roles do "orderEventsHandler"
    orderEventsHandler.addToRolePolicy(eventsDdbPolicy);

    // Lambda para BILLING
    const billingHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "BillingFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "BillingFunction",
        entry: "lambda/orders/billingFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Inscrição do "billingHandler" no tópico "ordersTopic"
    ordersTopic.addSubscription(
      new subs.LambdaSubscription(billingHandler, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ["ORDER_CREATED"],
          }),
        },
      })
    );

    // Fila DLQ (Dead-letter Queue) responsável por reter itens da fila principal que tiveram algum problema
    const orderEventsDlq = new sqs.Queue(this, "OrderEventsDlq", {
      queueName: "order-events-dlq",
      enforceSSL: false,
      encryption: sqs.QueueEncryption.UNENCRYPTED,
      retentionPeriod: cdk.Duration.days(4),
    });

    // Fila SQS p/ "Order Events" com DLQ
    const orderEventsQueue = new sqs.Queue(this, "OrderEventsQueue", {
      queueName: "order-events",
      enforceSSL: false,
      encryption: sqs.QueueEncryption.UNENCRYPTED,
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: orderEventsDlq,
      },
    });

    // Inscrição da fila "orderEventsQueue" no tópico "ordersTopic"
    ordersTopic.addSubscription(
      new subs.SqsSubscription(orderEventsQueue, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ["ORDER_CREATED"],
          }),
        },
      })
    );

    // Lambda para envio de emails por SQS
    const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "OrderEmailsFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrderEmailsFunction",
        entry: "lambda/orders/orderEmailsFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        layers: [orderEventsLayer],
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Lambda "orderEmailsHandler" será acionado quando algum item entrar na fila "orderEventsQueue"
    orderEmailsHandler.addEventSource(
      new lambdaEventSource.SqsEventSource(orderEventsQueue, {
        // Acumula 5 mensagens antes de chamar a lambda
        batchSize: 5,
        enabled: true,
        // Ou caso demore 1 minuto desde a primeira mensagem
        maxBatchingWindow: cdk.Duration.minutes(1),
      })
    );

    // Dar ao "orderEmailsHandler" permissão para consumir mensagens do "orderEventsQueue"
    orderEventsQueue.grantConsumeMessages(orderEmailsHandler);

    // Criação de policy para permitir a ação de envio de email pelo SES
    const orderEmailSesPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"],
    });

    // Atribui a policy "orderEmailSesPolicy" ao "orderEmailsHandler"
    orderEmailsHandler.addToRolePolicy(orderEmailSesPolicy);
  }
}
