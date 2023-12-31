import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

interface ECommerceApiStackProps extends cdk.StackProps {
    productsFetchHandler: lambdaNodeJS.NodejsFunction,
    productsAdminHandler: lambdaNodeJS.NodejsFunction,
    ordersHandler: lambdaNodeJS.NodejsFunction
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

        this.createProductsService(props, api);
        this.createOrdersService(props, api);
    }

    private createProductsService(props: ECommerceApiStackProps, api: apigateway.RestApi) {
        // Integração do API Gateway com o Lambda "productsFetchHandler"
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

        // Monta o Validator para o body do /products
        const productRequestValidator = new apigateway.RequestValidator(this, "ProductRequestValidator", {
            restApi: api,
            requestValidatorName: "Product request validator",
            validateRequestBody: true
        });

        // Modelo Product para validação
        const productModel = new apigateway.Model(this, "ProductModel", {
            modelName: "ProductModel",
            restApi: api,
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                    productName: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    code: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    price: {
                        type: apigateway.JsonSchemaType.INTEGER
                    },
                    model: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    productUrl: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                },
                required: [
                    "productName",
                    "code",
                    "price",
                    "model",
                    "productUrl"
                ]
            }
        });

        // Adiciona ao endpoint "/products" o método POST
        // e a integração do "productsAdminIntegration"
        productsResource.addMethod("POST", productsAdminIntegration, {
            requestValidator: productRequestValidator,
            requestModels: {
                "application/json": productModel
            }
        });
        // Adiciona ao endpoint "/products/{id}" o método PUT
        // e a integração do "productsAdminIntegration"
        productIdResource.addMethod("PUT", productsAdminIntegration);
        // Adiciona ao endpoint "/products/{id}" o método DELETE
        // e a integração do "productsAdminIntegration"
        productIdResource.addMethod("DELETE", productsAdminIntegration);
    }

    private createOrdersService(props: ECommerceApiStackProps, api: apigateway.RestApi) {
        // Integração do API Gateway com o Lambda "ordersHandler"
        const ordersIntegration = new apigateway.LambdaIntegration(props.ordersHandler);

        // Add o endpoint "/orders" no API Gateway
        const ordersResource = api.root.addResource("orders");

        // Adiciona ao endpoint "/orders" o método GET
        // e a integração do "ordersIntegration"
        ordersResource.addMethod("GET", ordersIntegration);

        // Monta o Validator para as querystrings do DELETE
        const orderDeletionvalidator = new apigateway.RequestValidator(this, "OrderDeletionvalidator", {
            restApi: api,
            requestValidatorName: "OrderDeletionvalidator",
            validateRequestParameters: true
        });

        // Adiciona ao endpoint "/orders" o método DELETE,
        // obrigando a enviar como querystring os attrs email e orderId
        // e a integração do "ordersIntegration"
        ordersResource.addMethod("DELETE", ordersIntegration, {
            requestParameters: {
                'method.request.querystring.email': true,
                'method.request.querystring.orderId': true
            },
            requestValidator: orderDeletionvalidator
        });

        // Monta o Validator para o body do POST /orders
        const orderRequestValidator = new apigateway.RequestValidator(this, "OrderRequestValidator", {
            restApi: api,
            requestValidatorName: "Order request validator",
            validateRequestBody: true
        });

        // Modelo Order para validação
        const orderModel = new apigateway.Model(this, "OrderModel", {
            modelName: "OrderModel",
            restApi: api,
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                properties: {
                    email: {
                        type: apigateway.JsonSchemaType.STRING
                    },
                    productIds: {
                        type: apigateway.JsonSchemaType.ARRAY,
                        minItems: 1,
                        items: {
                            type: apigateway.JsonSchemaType.STRING
                        }
                    },
                    payment: {
                        type: apigateway.JsonSchemaType.STRING,
                        enum: ["CASH", "DEBIT_CARD", "CREDIT_CARD"]
                    }
                },
                required: [
                    "email",
                    "productIds",
                    "payment"
                ]
            }
        });


        // Adiciona ao endpoint "/orders" o método POST
        // e a integração do "ordersIntegration"
        ordersResource.addMethod("POST", ordersIntegration, {
            requestValidator: orderRequestValidator,
            requestModels: {
                "application/json": orderModel
            }
        });
    }
}