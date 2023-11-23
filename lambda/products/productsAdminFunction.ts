import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

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
        
        return {
            statusCode: 201,
            body: JSON.stringify({
                message: "POST Products - OK"
            })
        }
    } else if (event.resource === "/products/{id}") {
        const productId = event.pathParameters!.id;

        if (method === "PUT") {
            console.log(`Método PUT /products/${productId}`);
            
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: `Método PUT /products/${productId} - OK`
                })
            }
        } else if (method === "DELETE") {
            console.log(`Método DELETE /products/${productId}`);
            
            return {
                statusCode: 200,
                body: JSON.stringify({
                    message: `Método DELETE /products/${productId} - OK`
                })
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