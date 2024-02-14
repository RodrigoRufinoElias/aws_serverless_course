import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// Classe para gerenciar TODAS as LAYERS lambda
// relacionadas à classe ORDER.
// LAYERS Lambda são lambdas com funcionalidades comuns
// entre lambdas functions.
export class OrdersAppLayersStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ordersLayers = new lambda.LayerVersion(this, "OrdersLayer", {
      code: lambda.Code.fromAsset("lambda/orders/layers/ordersLayer"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      layerVersionName: "OrdersLayer",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Guarda o "OrdersLayerVersionArn" no SSM
    new ssm.StringParameter(this, "OrdersLayerVersionArn", {
      parameterName: "OrdersLayerVersionArn",
      stringValue: ordersLayers.layerVersionArn,
    });

    const ordersApiLayers = new lambda.LayerVersion(this, "OrdersApiLayer", {
      code: lambda.Code.fromAsset("lambda/orders/layers/ordersApiLayer"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      layerVersionName: "OrdersApiLayer",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Guarda o "OrdersApiLayerVersionArn" no SSM
    new ssm.StringParameter(this, "OrdersApiLayerVersionArn", {
      parameterName: "OrdersApiLayerVersionArn",
      stringValue: ordersApiLayers.layerVersionArn,
    });

    const orderEventsLayers = new lambda.LayerVersion(
      this,
      "OrderEventsLayer",
      {
        code: lambda.Code.fromAsset("lambda/orders/layers/orderEventsLayer"),
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        layerVersionName: "OrderEventsLayer",
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }
    );

    // Guarda o "OrderEventsLayerVersionArn" no SSM
    new ssm.StringParameter(this, "OrderEventsLayerVersionArn", {
      parameterName: "OrderEventsLayerVersionArn",
      stringValue: orderEventsLayers.layerVersionArn,
    });

    const orderEventsRepositoryLayers = new lambda.LayerVersion(
      this,
      "OrderEventsRepositoryLayer",
      {
        code: lambda.Code.fromAsset(
          "lambda/orders/layers/orderEventsRepositoryLayer"
        ),
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        layerVersionName: "OrderEventsRepositoryLayer",
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }
    );

    // Guarda o "OrderEventsRepositoryLayerVersionArn" no SSM
    new ssm.StringParameter(this, "OrderEventsRepositoryLayerVersionArn", {
      parameterName: "OrderEventsRepositoryLayerVersionArn",
      stringValue: orderEventsRepositoryLayers.layerVersionArn,
    });
  }
}
