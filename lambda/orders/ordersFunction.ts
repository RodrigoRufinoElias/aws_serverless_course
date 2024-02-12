import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { Order, OrderRepository } from "/opt/nodejs/ordersLayer";
import { Product, ProductRepository } from "/opt/nodejs/productsLayer";
import { DynamoDB, SNS } from "aws-sdk";
import * as AWSXRay from "aws-xray-sdk";
import {
  CarrierType,
  OrderProductResponse,
  OrderRequest,
  OrderResponse,
  PaymentType,
  ShippingType,
} from "./layers/ordersApiLayer/nodejs/orderApi";
import { OrderEvent, OrderEventType, Envelope } from "/opt/nodejs/orderEventsLayer";
import { v4 as uuid } from "uuid";

// Usa o XRay para capturar o tempo de execução de tudo oq consome o "aws-sdk"
AWSXRay.captureAWS(require("aws-sdk"));

// Recupera nome das tabela através do env
const ordersDdb = process.env.ORDERS_DDB!;
const productsDdb = process.env.PRODUCTS_DDB!;
const orderEventsTopicArn = process.env.ORDER_EVENTS_TOPIC_ARN!;

// Inicia client do DB
const ddbClient = new DynamoDB.DocumentClient();

// Inicia Order Repository
const orderRepository = new OrderRepository(ddbClient, ordersDdb);

// Inicia Product Repository
const productRepository = new ProductRepository(ddbClient, productsDdb);

// Inicia o client do SNS
const snsClient = new SNS();

// Lambda function responsável pela gestão de pedidos
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

  // Não precisa verificar o resource pois sempre será chamado por "/orders"
  if (method === "GET") {
    if (event.queryStringParameters) {
      console.log("GET /orders chamado");
      const email = event.queryStringParameters.email;
      const orderId = event.queryStringParameters.orderId;

      if (email) {
        // Busca um pedido de um usuário
        if (orderId) {
          try {
            const order = await orderRepository.getOrder(email, orderId);

            return {
              statusCode: 200,
              body: JSON.stringify(convertToOrderResponse(order)),
            };
          } catch (error) {
            console.log((<Error>error).message);
            return {
              statusCode: 404,
              body: (<Error>error).message,
            };
          }
        } else {
          // Busca todos os pedidos de um usuário
          const orders = await orderRepository.getOrdersByEmail(email);

          return {
            statusCode: 200,
            body: JSON.stringify(orders.map(convertToOrderResponse)),
          };
        }
      }
    } else {
      const orders = await orderRepository.getAllOrders();

      return {
        statusCode: 200,
        body: JSON.stringify(orders.map(convertToOrderResponse)),
      };
    }
  } else if (method === "POST") {
    console.log("POST /orders chamado");
    const orderRequest = JSON.parse(event.body!) as OrderRequest;
    const products = await productRepository.getProductByIds(
      orderRequest.productIds
    );

    if (products.length === orderRequest.productIds.length) {
      const order = buildOrder(orderRequest, products);

      const orderCreatedPromise = orderRepository.createOrder(order);

      const eventResultPromise = sendOrderEvent(order, OrderEventType.CREATED, lambdaRequestId);

      const result = await Promise.all([orderCreatedPromise, eventResultPromise])

      console.log(
        `Order event creation sent -
        OrderId: ${order.sk} - 
        MessageId: ${result[1].MessageId}`
      );
      
      return {
        statusCode: 201,
        body: JSON.stringify(convertToOrderResponse(order)),
      };
    } else {
      return {
        statusCode: 404,
        body: "One or more products were not found",
      };
    }
  } else if (method === "DELETE") {
    console.log("DELETE /orders chamado");
    const email = event.queryStringParameters!.email!;
    const orderId = event.queryStringParameters!.orderId!;

    try {
      const orderDelete = await orderRepository.deleteOrder(email, orderId);

      const eventResult = await sendOrderEvent(orderDelete, OrderEventType.DELETED, lambdaRequestId);

      console.log(
        `Order event delete sent -
        OrderId: ${orderDelete.sk} - 
        MessageId: ${eventResult.MessageId}`
      );

      return {
        statusCode: 200,
        body: JSON.stringify(convertToOrderResponse(orderDelete)),
      };
    } catch (error) {
      console.log((<Error>error).message);
      return {
        statusCode: 404,
        body: (<Error>error).message,
      };
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: "Bad request",
    }),
  };
}

function sendOrderEvent(order: Order, eventType: OrderEventType, lambdaRequestId: string) {
  const productCodes: string[] = [];

  order.products.forEach((p) => {
    productCodes.push(p.code);
  });
  
  const orderEvent: OrderEvent = {
    email: order.pk,
    orderId: order.sk!,
    billing: order.billing,
    shipping: order.shipping,
    requestId: lambdaRequestId,
    productCodes
  };

  const envelope: Envelope = {
    eventType,
    data: JSON.stringify(orderEvent)
  };
  
  // Publicar tópico
  return snsClient.publish({
    TopicArn: orderEventsTopicArn,
    Message: JSON.stringify(envelope),
    // Insere o attr de msg para seu filtrado
    MessageAttributes: {
      eventType: {
        DataType: "String",
        StringValue: eventType
      }
    }
  }).promise();
}

function convertToOrderResponse(order: Order): OrderResponse {
  const orderProducts: OrderProductResponse[] = [];

  order.products.forEach((product) => {
    orderProducts.push({
      code: product.code,
      price: product.price,
    });
  });

  const orderResponse: OrderResponse = {
    email: order.pk,
    id: order.sk!,
    createdAt: order.createdAt!,
    products: orderProducts,
    billing: {
      payment: order.billing.payment as PaymentType,
      totalPrice: order.billing.totalPrice,
    },
    shipping: {
      type: order.shipping.type as ShippingType,
      carrier: order.shipping.carrier as CarrierType,
    },
  };

  return orderResponse;
}

function buildOrder(orderRequest: OrderRequest, products: Product[]): Order {
  const orderProducts: OrderProductResponse[] = [];

  let totalPrice = 0;

  products.forEach((product) => {
    totalPrice += product.price;
    orderProducts.push({
      code: product.code,
      price: product.price,
    });
  });

  const order: Order = {
    pk: orderRequest.email,
    sk: uuid(),
    createdAt: Date.now(),
    billing: {
      payment: orderRequest.payment,
      totalPrice: totalPrice,
    },
    shipping: {
      type: orderRequest.shipping.type,
      carrier: orderRequest.shipping.carrier,
    },
    products: orderProducts,
  };

  return order;
}
