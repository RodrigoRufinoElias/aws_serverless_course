import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

interface ECommerceApiStackProps extends cdk.StackProps {
    productsFetchHandler: lambdaNodeJS.NodejsFunction,
    productsAdminHandler: lambdaNodeJS.NodejsFunction
}

// Stack para criação de API Gateway e integrar
// com as Lambda functions
export class ECommerceApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: ECommerceApiStackProps) {
        super(scope, id, props);

        const logGroup = new cwlogs.LogGroup(this, "ECommerceAPILogs")
        const api = new apigateway.RestApi(this, "EcommerceAPI", {
            restApiName: "EcommerceAPI",
            cloudWatchRole: true,
            deployOptions: {
                accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    httpMethod: true,
                    ip: true,
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    caller: true,
                    user: true
                })
            }
        });

        // Integração do API Gateway com o Lambda "productsFetchIntegration"
        const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler);
        // Integração do API Gateway com o Lambda "productsAdminHandler"
        const productsAdminIntegration = new apigateway.LambdaIntegration(props.productsAdminHandler);

        // Add o endpoint "/products" no API Gateway
        const productsResource = api.root.addResource("products");
        // Add o endpoint "/products/{id}" no API Gateway
        const productIdResource = productsResource.addResource("{id}");
        
        // Adiciona ao endpoint "/products" o método GET
        // e a integração do "productsFetchIntegration"
        productsResource.addMethod("GET", productsFetchIntegration);
        // Adiciona ao endpoint "/products/{id}" o método GET
        // e a integração do "productsFetchIntegration"
        productIdResource.addMethod("GET", productsFetchIntegration);

        // Adiciona ao endpoint "/products" o método POST
        // e a integração do "productsAdminIntegration"
        productsResource.addMethod("POST", productsAdminIntegration);
        // Adiciona ao endpoint "/products/{id}" o método PUT
        // e a integração do "productsAdminIntegration"
        productIdResource.addMethod("PUT", productsAdminIntegration);
        // Adiciona ao endpoint "/products/{id}" o método DELETE
        // e a integração do "productsAdminIntegration"
        productIdResource.addMethod("DELETE", productsAdminIntegration);
    }
}