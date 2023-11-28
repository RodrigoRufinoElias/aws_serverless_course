import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
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

// Lambda function responsável pela administração de produtos
export async function handler(
    event: APIGatewayProxyEvent, 
    context: Context) : Promise<APIGatewayProxyResult> {
    
    const lambdaRequestId = context.awsRequestId;
    const apiRequestId = event.requestContext.requestId;
    const method = event.httpMethod;

    console.log(`API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`);

    if (event.resource === "/products") {
        console.log("Método POST chamado");

        const product = JSON.parse(event.body!) as Product;
        const productCreated = await productRepository.createProduct(product);
        
        return {
            statusCode: 201,
            body: JSON.stringify(productCreated)
        }
    } else if (event.resource === "/products/{id}") {
        const productId = event.pathParameters!.id as string;

        if (method === "PUT") {
            console.log(`Método PUT /products/${productId}`);
            
            const product = JSON.parse(event.body!) as Product;

            try {
                const productUpdated = await productRepository.updateProduct(productId, product);
                
                return {
                    statusCode: 200,
                    body: JSON.stringify(productUpdated)
                }
            } catch (ConditionalCheckFailedException) {
                return {
                    statusCode: 404,
                    body: "Product not found"
                }
            }
        } else if (method === "DELETE") {
            console.log(`Método DELETE /products/${productId}`);
            
            try {
                const product = await productRepository.deleteProduct(productId);
                
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
    }

    return {
        statusCode: 400,
        body: JSON.stringify({
            message: "Bad request"
        })
    }
}