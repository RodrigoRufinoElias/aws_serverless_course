import * as cdk from "aws-cdk-lib";
import * as dynadb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// Classe para gerenciar TODAS as funções lambda
// e integrações com DB relacionadas à classe EVENTS
export class EventsDdbStack extends cdk.Stack {
  readonly table: dynadb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Função de gerenciamento da tabela EVENTS
    this.table = new dynadb.Table(this, "EventsDdb", {
      tableName: "events",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
      // Tempo para manter dados
      timeToLiveAttribute: "ttl",
      billingMode: dynadb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
    });

    // Add GSI (Global Secondary Index) para gerar tabela indexada
    this.table.addGlobalSecondaryIndex({
      indexName: "emailIndex",
      partitionKey: {
        name: "email",
        type: dynadb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: dynadb.AttributeType.STRING,
      },
      projectionType: dynadb.ProjectionType.ALL,
    });

    // Auto-scale de leitura
    const readScale = this.table.autoScaleReadCapacity({
      maxCapacity: 2,
      minCapacity: 1,
    });

    readScale.scaleOnUtilization({
      targetUtilizationPercent: 50,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Auto-scale de escrita
    const writeScale = this.table.autoScaleWriteCapacity({
      maxCapacity: 4,
      minCapacity: 1,
    });

    writeScale.scaleOnUtilization({
      targetUtilizationPercent: 30,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });
  }
}
