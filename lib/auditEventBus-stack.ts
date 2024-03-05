import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

// Classe para auditorar outras stacks pelo Event Bridge
export class AuditEventBusStack extends cdk.Stack {
  readonly bus: events.EventBus;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.bus = new events.EventBus(this, "AuditEventBus", {
      eventBusName: "AuditEventBus",
    });

    this.bus.archive("BusArchive", {
      eventPattern: {
        source: ["app.order"],
      },
      archiveName: "auditEvents",
      retention: cdk.Duration.days(10),
    });

    // Regra de encaminhamento para quando não achar produtos quando realizar um pedido
    const nonValidOrderRule = new events.Rule(this, "NonValidOrderRule", {
      ruleName: "NonValidOrderRule",
      description: "Rule matching non valid order",
      eventBus: this.bus,
      eventPattern: {
        source: ["app.order"],
        detailType: ["order"],
        detail: {
          // Esse parâmetro pode ser dinâmico
          reason: ["PRODUCT_NOT_FOUND"],
        },
      },
    });

    // Lambda para onde é encaminhado o erro da regra "nonValidOrderRule"
    const ordersErrorsFunction = new lambdaNodeJS.NodejsFunction(
      this,
      "OrdersErrorsFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "OrdersErrorsFunction",
        entry: "lambda/audit/ordersErrorsFunction.ts",
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

    // Explicita o alvo da regra "nonValidOrderRule"
    nonValidOrderRule.addTarget(
      new targets.LambdaFunction(ordersErrorsFunction)
    );

    // Regra de encaminhamento para quando não achar o número do invoice quando criar invoices
    const nonValidInvoiceRule = new events.Rule(this, "NonValidInvoiceRule", {
      ruleName: "NonValidInvoiceRule",
      description: "Rule matching non valid invoice",
      eventBus: this.bus,
      eventPattern: {
        source: ["app.invoice"],
        detailType: ["invoice"],
        detail: {
          // Esse parâmetro pode ser dinâmico
          errorDetail: ["FAIL_NO_INVOICE_NUMBER"],
        },
      },
    });

    // Lambda para onde é encaminhado o erro da regra "nonValidInvoiceRule"
    const invoicesErrorsFunction = new lambdaNodeJS.NodejsFunction(
      this,
      "InvoicesErrorsFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "InvoicesErrorsFunction",
        entry: "lambda/audit/invoicesErrorsFunction.ts",
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

    // Explicita o alvo da regra "nonValidInvoiceRule"
    nonValidInvoiceRule.addTarget(
      new targets.LambdaFunction(invoicesErrorsFunction)
    );

    // Regra de encaminhamento para quando der timeout quando criar invoices
    const timeoutInvoiceRule = new events.Rule(this, "TimeoutInvoiceRule", {
      ruleName: "TimeoutInvoiceRule",
      description: "Rule matching timeout import invoice",
      eventBus: this.bus,
      eventPattern: {
        source: ["app.invoice"],
        detailType: ["invoice"],
        detail: {
          // Esse parâmetro pode ser dinâmico
          errorDetail: ["TIMEOUT"],
        },
      },
    });

    // Fila SQS para onde é encaminhado o erro da regra "timeoutInvoiceRule"
    const invoiceImportTimeoutQueue = new sqs.Queue(
      this,
      "InvoiceImportTimeout",
      {
        queueName: "invoice-import-timeout",
      }
    );

    // Explicita o alvo da regra "timeoutInvoiceRule"
    timeoutInvoiceRule.addTarget(
      new targets.SqsQueue(invoiceImportTimeoutQueue)
    );

    // Cloudwatch
    // Métrica para mensagens visíveis acumuladas
    const numberOfMessagesMetric =
      invoiceImportTimeoutQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(2),
        statistic: "Sum",
      });

    // Alarme para métrica "numberOfMessagesMetric"
    numberOfMessagesMetric.createAlarm(this, "InvoiceImportTimeoutAlarm", {
      alarmName: "InvoiceImportTimeout",
      actionsEnabled: false,
      evaluationPeriods: 1,
      threshold: 5,
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // Métrica para mensagens muito antigas aguardando consumo
    const ageOfMessagesMetric =
      invoiceImportTimeoutQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(2),
        statistic: "Maximum",
        unit: cw.Unit.SECONDS,
      });

    // Alarme para métrica "ageOfMessagesMetric"
    ageOfMessagesMetric.createAlarm(this, "AgeOfMessagesInQueue", {
      alarmName: "AgeOfMessagesInQueue",
      actionsEnabled: false,
      evaluationPeriods: 1,
      threshold: 60,
      comparisonOperator:
        cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
  }
}
