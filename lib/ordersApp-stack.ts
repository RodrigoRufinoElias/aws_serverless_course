import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynadb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

interface OrdersAppStackProps extends cdk.StackProps {
    productsDdb: dynadb.Table,
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
                type: dynadb.AttributeType.STRING
            },
            // Chave secundária
            sortKey: {
                name: "sk",
                type: dynadb.AttributeType.STRING
            },
            billingMode: dynadb.BillingMode.PROVISIONED,
            readCapacity: 1,
            writeCapacity: 1
        });

        // Orders Layer
        const ordersLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersLayerVersionArn");
        const ordersLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersLayerVersionArn", ordersLayerArn);

        // Orders API Layer
        const ordersApiLayerArn = ssm.StringParameter.valueForStringParameter(this, "OrdersApiLayerVersionArn");
        const ordersApiLayer = lambda.LayerVersion.fromLayerVersionArn(this, "OrdersApiLayerVersionArn", ordersApiLayerArn);

        // Products Layer
        const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn");
        const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn);

        // Lambda para ORDERS
        this.ordersHandler = new lambdaNodeJS.NodejsFunction(this,
            "OrdersFunction", {
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
                },
                layers: [ordersLayer, productsLayer, ordersApiLayer],
                // Habilita o log Tracing das funções lambda pelo XRay.
                tracing:lambda.Tracing.ACTIVE,
                // Habilita o Lambda Insight
                insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
            });

        // Dar ao "ordersHandler" permissão de leitura 
        // e escrita na tabela "orders".
        ordersDdb.grantReadWriteData(this.ordersHandler);
        // Dar ao "ordersHandler" permissão de leitura 
        // na tabela "products".
        props.productsDdb.grantReadData(this.ordersHandler);
    }
}