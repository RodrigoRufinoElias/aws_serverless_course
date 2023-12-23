import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynadb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

interface ProductsAppStackProps extends cdk.StackProps {
    eventsDdb: dynadb.Table,
}

// Classe para gerenciar TODAS as funções lambda 
// e integrações com DB relacionadas à classe PRODUCT
export class ProductsAppStack extends cdk.Stack {
    readonly productsFetchHandler: lambdaNodeJS.NodejsFunction;
    readonly productsAdminHandler: lambdaNodeJS.NodejsFunction;
    readonly productsDdb: dynadb.Table;

    constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
        super(scope, id, props);

        // Função de gerenciamento da tabela PRODUCTS
        this.productsDdb = new dynadb.Table(this, "ProductsDdb", {
            tableName: "products",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            // Chave primária
            partitionKey: {
                name: "id",
                type: dynadb.AttributeType.STRING
            },
            billingMode: dynadb.BillingMode.PROVISIONED,
            readCapacity: 1,
            writeCapacity: 1
        });

        // Products Layer
        const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn");
        const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn);

        // Product Events Layer
        const productEventsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductEventsLayerVersionArn");
        const productEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductEventsLayerVersionArn", productEventsLayerArn);

        // Lambda para PRODUCTS <-> EVENTS
        // Não precisa ser acessado em outra classe. Por isso é CONST.
        const productEventsHandler = new lambdaNodeJS.NodejsFunction(this,
            "ProductsEventsFunction", {
                runtime: lambda.Runtime.NODEJS_20_X,
                functionName: "ProductsEventsFunction",
                entry: "lambda/products/productEventsFunction.ts",
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
                    EVENTS_DDB: props.eventsDdb.tableName
                },
                layers: [productEventsLayer],
                // Habilita o log Tracing das funções lambda pelo XRay.
                tracing:lambda.Tracing.ACTIVE,
                // Habilita o Lambda Insight
                insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
            });

        // Dar ao "productEventsHandler" permissão de leitura 
        // na tabela "events".
        props.eventsDdb.grantWriteData(productEventsHandler);

        // Lambda para PRODUCTS FETCH (GET)
        this.productsFetchHandler = new lambdaNodeJS.NodejsFunction(this,
            "ProductsFetchFunction", {
                runtime: lambda.Runtime.NODEJS_20_X,
                functionName: "ProductsFetchFunction",
                entry: "lambda/products/productsFetchFunction.ts",
                handler: "handler",
                memorySize: 512,
                timeout: cdk.Duration.seconds(5),
                bundling: {
                    minify: true,
                    sourceMap: false,
                },
                // É necessário integrar o nome da tabela à função.
                // Posso usar qualquer nome para o env. Nesse caso,
                // usei PRODUCTS_DDB.
                environment: {
                    PRODUCTS_DDB: this.productsDdb.tableName
                },
                layers: [productsLayer],
                // Habilita o log Tracing das funções lambda pelo XRay.
                tracing:lambda.Tracing.ACTIVE,
                // Habilita o Lambda Insight
                insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
            });

        // Dar ao "productsFetchHandler" permissão de leitura 
        // na tabela "products".
        this.productsDdb.grantReadData(this.productsFetchHandler);

        // Lambda para PRODUCTS ADMIN (POST, UPDATE e DELETE).
        // Decidido separar as lambdas pois controla melhor o
        // consumo e as permissões.
        this.productsAdminHandler = new lambdaNodeJS.NodejsFunction(this,
            "ProductsAdminFunction", {
                runtime: lambda.Runtime.NODEJS_20_X,
                functionName: "ProductsAdminFunction",
                entry: "lambda/products/productsAdminFunction.ts",
                handler: "handler",
                memorySize: 512,
                timeout: cdk.Duration.seconds(5),
                bundling: {
                    minify: true,
                    sourceMap: false,
                },
                // Mesmo environment da lambda anterior.
                environment: {
                    PRODUCTS_DDB: this.productsDdb.tableName,
                    // Permite que esta lambda acesse o "productEventsHandler"
                    PRODUCT_EVENTS_FUNCTION_NAME: productEventsHandler.functionName
                },
                layers: [productsLayer, productEventsLayer],
                // Habilita o log Tracing das funções lambda pelo XRay.
                tracing:lambda.Tracing.ACTIVE,
                // Habilita o Lambda Insight
                insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
            });

        // Dar ao "productsAdminHandler" permissão de escrita 
        // na tabela "products".
        this.productsDdb.grantWriteData(this.productsAdminHandler);
        // Dar ao "productsAdminHandler" permissão de invocar 
        // o "productEventsHandler".
        productEventsHandler.grantInvoke(this.productsAdminHandler);
    }
}