import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// Classe para exportar TODAS as funções lambda 
// relacionadas à classe PRODUCT
export class ProductsAppStack extends cdk.Stack {
    readonly productsFetchHandler: lambdaNodeJS.NodejsFunction;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        this.productsFetchHandler = new lambdaNodeJS.NodejsFunction(this,
            "ProductsFetchFunction", {
                // parâmetro RUNTIME é necessário para utilizar
                // o nodeJS v16 com o AWS SDK v2. Caso não use,
                // irá utilizar o nodeJS mais atual com AWS SDK v3.
                runtime: lambda.Runtime.NODEJS_16_X,
                functionName: "ProductsFetchFunction",
                entry: "lambda/products/productsFetchFunction.ts",
                handler: "handler",
                memorySize: 128,
                timeout: cdk.Duration.seconds(5),
                bundling: {
                    minify: true,
                    sourceMap: false,
                }
            });
    }
}