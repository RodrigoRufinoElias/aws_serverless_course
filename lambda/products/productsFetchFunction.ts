import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { ProductRepository } from "/opt/nodejs/productsLayer";
import { DynamoDB } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome da tabela através do env
const productsDdb = process.env.PRODUCTS_DDB!;
// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

// Inicia Product Repository
const productRepository = new ProductRepository(ddbClient, productsDdb);

// Lambda function responsável pelas busca de produtos
export async function handler(
    event: APIGatewayProxyEvent, 
    context: Context) : Promise<APIGatewayProxyResult> {
    
    const lambdaRequestId = context.awsRequestId;
    const apiRequestId = event.requestContext.requestId;
    const method = event.httpMethod;

    console.log(`API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`);

    if (event.resource === "/products") {
        if(method === "GET") {
            console.log("Método GET chamado");

            const products = await productRepository.getAllProducts();
            
            return {
                statusCode: 200,
                body: JSON.stringify(products)
            }
        }
    } else if (event.resource === "/products/{id}") {
        const productId = event.pathParameters!.id as string;

        console.log(`Método GET /products/${productId}`);

        try {
            const product = await productRepository.getProductById(productId);
            
            return {
                statusCode: 200,
                body: JSON.stringify(product)
            }
        } catch (error) {
            console.error((<Error>error).message);
            
            return {
                statusCode: 404,
                body: (<Error>error).message
            }
        }
    }

    return {
        statusCode: 400,
        body: JSON.stringify({
            message: "Bad request"
        })
    }
}