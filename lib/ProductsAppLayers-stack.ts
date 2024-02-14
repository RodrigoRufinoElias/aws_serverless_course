import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// Classe para gerenciar TODAS as LAYERS lambda
// relacionadas à classe PRODUCT.
// LAYERS Lambda são lambdas com funcionalidades comuns
// entre lambdas functions.
export class ProductAppLayersStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const productsLayers = new lambda.LayerVersion(this, "ProductLayer", {
      code: lambda.Code.fromAsset("lambda/products/layers/productsLayer"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      layerVersionName: "ProductsLayer",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Guarda o "ProductsLayerVersionArn" no SSM
    new ssm.StringParameter(this, "ProductsLayerVersionArn", {
      parameterName: "ProductsLayerVersionArn",
      stringValue: productsLayers.layerVersionArn,
    });

    const productEventsLayers = new lambda.LayerVersion(
      this,
      "ProductEventsLayer",
      {
        code: lambda.Code.fromAsset(
          "lambda/products/layers/productEventsLayer"
        ),
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        layerVersionName: "ProductEventsLayer",
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }
    );

    // Guarda o "ProductEventsLayerVersionArn" no SSM
    new ssm.StringParameter(this, "ProductEventsLayerVersionArn", {
      parameterName: "ProductEventsLayerVersionArn",
      stringValue: productEventsLayers.layerVersionArn,
    });
  }
}
