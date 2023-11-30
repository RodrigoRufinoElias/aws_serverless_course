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
            code: lambda.Code.fromAsset('lambda/orders/layers/ordersLayer'),
            compatibleRuntimes: [lambda.Runtime.NODEJS_16_X],
            layerVersionName: "OrdersLayer",
            removalPolicy: cdk.RemovalPolicy.RETAIN
        });

        // Guarda o "OrdersLayerVersionArn" no SSM
        new ssm.StringParameter(this, "OrdersLayerVersionArn", {
            parameterName: "OrdersLayerVersionArn",
            stringValue: ordersLayers.layerVersionArn
        });
    }
}