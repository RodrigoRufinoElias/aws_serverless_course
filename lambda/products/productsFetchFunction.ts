import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

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
            
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: "GET Products - OK"
                })
            }
        }
    } else if (event.resource === "/products/{id}") {
        const productId = event.pathParameters!.id;

        console.log(`Método GET /products/${productId}`);
            
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Método GET /products/${productId} - OK`
            })
        }
    }

    return {
        statusCode: 400,
        body: JSON.stringify({
            message: "Bad request"
        })
    }
}