import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { CognitoIdentityServiceProvider, DynamoDB, Lambda } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";
import { ProductEvent, ProductEventType } from "/opt/nodejs/productEventsLayer";
import { AuthInfoService } from "/opt/nodejs/authUserInfo";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nomes das tabelas através do env
const productsDdb = process.env.PRODUCTS_DDB!;
const productEventsFunctionName = process.env.PRODUCT_EVENTS_FUNCTION_NAME!;

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();
// Inicia client do Lambda
const lambdaClient = new Lambda();

// Inicia client do CognitoIdentityServiceProvider
const cognitoIdentityServiceProvider = new CognitoIdentityServiceProvider();

// Inicia Product Repository
const productRepository = new ProductRepository(ddbClient, productsDdb);

// Inicia Auth Info Service
const authInfoService = new AuthInfoService(cognitoIdentityServiceProvider);

// Lambda function responsável pela administração de produtos
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> {
  const lambdaRequestId = context.awsRequestId;
  const apiRequestId = event.requestContext.requestId;
  const method = event.httpMethod;

  console.log(
    `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`
  );

  const userEmail = await authInfoService.getUserInfo(
    event.requestContext.authorizer
  );

  if (event.resource === "/products") {
    console.log("Método POST chamado");

    const product = JSON.parse(event.body!) as Product;
    const productCreated = await productRepository.createProduct(product);

    const response = await sendProductEvent(
      productCreated,
      ProductEventType.CREATED,
      userEmail,
      lambdaRequestId
    );

    console.log(response);

    return {
      statusCode: 201,
      body: JSON.stringify(productCreated),
    };
  } else if (event.resource === "/products/{id}") {
    const productId = event.pathParameters!.id as string;

    if (method === "PUT") {
      console.log(`Método PUT /products/${productId}`);

      const product = JSON.parse(event.body!) as Product;

      try {
        const productUpdated = await productRepository.updateProduct(
          productId,
          product
        );

        const response = await sendProductEvent(
          productUpdated,
          ProductEventType.UPDATED,
          userEmail,
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(productUpdated),
        };
      } catch (ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          body: "Product not found",
        };
      }
    } else if (method === "DELETE") {
      console.log(`Método DELETE /products/${productId}`);

      try {
        const product = await productRepository.deleteProduct(productId);

        const response = await sendProductEvent(
          product,
          ProductEventType.DELETED,
          userEmail,
          lambdaRequestId
        );

        console.log(response);

        return {
          statusCode: 200,
          body: JSON.stringify(product),
        };
      } catch (error) {
        console.error((<Error>error).message);

        return {
          statusCode: 404,
          body: (<Error>error).message,
        };
      }
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request",
    }),
  };
}

// Funcção responsável por invocar a função Lambda de Eventos
function sendProductEvent(
  product: Product,
  eventType: ProductEventType,
  email: string,
  lambdaRequestId: string
) {
  const event: ProductEvent = {
    email: email,
    eventType: eventType,
    productCode: product.code,
    productId: product.id,
    productPrice: product.price,
    requestId: lambdaRequestId,
  };

  return lambdaClient
    .invoke({
      FunctionName: productEventsFunctionName,
      Payload: JSON.stringify(event),
      // Explicita que o tipo de chamada é SÍNCRONA.
      // Caso queira ASSÍNCRONA, use "Event". Mas não tem retorno.
      InvocationType: "RequestResponse",
    })
    .promise();
}
