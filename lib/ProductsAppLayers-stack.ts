import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Lambda } from "aws-cdk-lib/aws-ses-actions";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// Classe para gerenciar TODAS as LAYERS lambda 
// relacionadas à classe PRODUCT.
// LAYERS Lambda são lambdas com funcionalidades comuns
// entre lambdas functions. 
export class ProductAppLayersStack extends cdk.Stack {
    readonly productsLayers: lambda.LayerVersion;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.productsLayers = new lambda.LayerVersion(this, "ProductLayer", {
            code: lambda.Code.fromAsset('lambda/products/layers/productsLayer'),
            compatibleRuntimes: [lambda.Runtime.NODEJS_16_X],
            layerVersionName: "ProductsLayer",
            removalPolicy: cdk.RemovalPolicy.RETAIN
        });

        // Guarda o "ProductsLayerVersionArn" no SSM
        new ssm.StringParameter(this, "ProductsLayerVersionArn", {
            parameterName: "ProductsLayerVersionArn",
            stringValue: this.productsLayers.layerVersionArn
        });
    }
}