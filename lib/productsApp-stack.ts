import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as dynadb from "aws-cdk-lib/aws-dynamodb";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

// Classe para gerenciar TODAS as funções lambda 
// e integrações com DB relacionadas à classe PRODUCT
export class ProductsAppStack extends cdk.Stack {
    readonly productsFetchHandler: lambdaNodeJS.NodejsFunction;
    readonly productsAdminHandler: lambdaNodeJS.NodejsFunction;
    readonly productsDdb: dynadb.Table;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Função de gerenciamento da tabela PRODUCTS
        this.productsDdb = new dynadb.Table(this, "ProductsDdb", {
            tableName: "products",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
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

        // Lambda para PRODUCTS FETCH (GET)
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
            });

        // Dar ao "productsFetchHandler" permissão de leitura 
        // na tabela "products".
        this.productsDdb.grantReadData(this.productsFetchHandler);

        // Lambda para PRODUCTS ADMIN (POST, UPDATE e DELETE).
        // Decidido separar as lambdas pois controla melhor o
        // consumo e as permissões.
        this.productsAdminHandler = new lambdaNodeJS.NodejsFunction(this,
            "ProductsAdminFunction", {
                // parâmetro RUNTIME é necessário para utilizar
                // o nodeJS v16 com o AWS SDK v2. Caso não use,
                // irá utilizar o nodeJS mais atual com AWS SDK v3.
                runtime: lambda.Runtime.NODEJS_16_X,
                functionName: "ProductsAdminFunction",
                entry: "lambda/products/productsAdminFunction.ts",
                handler: "handler",
                memorySize: 128,
                timeout: cdk.Duration.seconds(5),
                bundling: {
                    minify: true,
                    sourceMap: false,
                },
                // Mesmo environment da lambda anterior.
                environment: {
                    PRODUCTS_DDB: this.productsDdb.tableName
                },
                layers: [productsLayer],
                // Habilita o log Tracing das funções lambda pelo XRay.
                tracing:lambda.Tracing.ACTIVE
            });

        // Dar ao "productsAdminHandler" permissão de escrita 
        // na tabela "products".
        this.productsDdb.grantWriteData(this.productsAdminHandler);
    }
}