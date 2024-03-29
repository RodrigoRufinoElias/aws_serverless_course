#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ProductsAppStack } from "../lib/productsApp-stack";
import { ECommerceApiStack } from "../lib/ecommerceApi-stack";
import { ProductAppLayersStack } from "../lib/ProductsAppLayers-stack";
import { EventsDdbStack } from "../lib/eventsDdb-stack";
import { OrdersAppLayersStack } from "../lib/ordersAppLayers-stack";
import { OrdersAppStack } from "../lib/ordersApp-stack";
import { WebSocketStack } from "../lib/websocket-stack";
import { InvoiceWSApiStack } from "../lib/invoiceWSAPI-stack";
import { InvoicesAppLayersStack } from "../lib/invoicesAppLayers-stack";
import { AuditEventBusStack } from "../lib/auditEventBus-stack";
import { AuthLayersStack } from "../lib/authLayers-stack";

const app = new cdk.App();

// Env da conta AWS. Varia caso use ambientes diferentes.
const env: cdk.Environment = {
  account: "",
  region: "us-east-1",
};

// Tags para controle. É importante customizar!
const tags = {
  cost: "ECommerce",
  team: "Ruffos",
};

const auditEventBusStack = new AuditEventBusStack(app, "AuditEvents", {
  tags: {
    cost: "Audit",
    team: "Ruffos",
  },
  env: env,
});

const authLayersStack = new ProductAppLayersStack(app, "AuthLayers", {
  tags: tags,
  env: env,
});

const productAppLayersStack = new ProductAppLayersStack(
  app,
  "ProductsAppLayers",
  {
    tags: tags,
    env: env,
  }
);

const eventsDdbStack = new EventsDdbStack(app, "EventsDdb", {
  tags: tags,
  env: env,
});

const productsAppStack = new ProductsAppStack(app, "ProductsApp", {
  eventsDdb: eventsDdbStack.table,
  tags: tags,
  env: env,
});

productsAppStack.addDependency(productAppLayersStack);
productsAppStack.addDependency(authLayersStack);
productsAppStack.addDependency(eventsDdbStack);

const ordersAppLayersStack = new OrdersAppLayersStack(
  app,
  "OrdersAppLayersStack",
  {
    tags: tags,
    env: env,
  }
);

const ordersAppStack = new OrdersAppStack(app, "OrdersAppStack", {
  productsDdb: productsAppStack.productsDdb,
  eventsDdb: eventsDdbStack.table,
  auditBus: auditEventBusStack.bus,
  tags: tags,
  env: env,
});

ordersAppStack.addDependency(productsAppStack);
ordersAppStack.addDependency(ordersAppLayersStack);
ordersAppStack.addDependency(eventsDdbStack);
ordersAppStack.addDependency(auditEventBusStack);

new WebSocketStack(app, "webSocketStack", {
  tags: tags,
  env: env,
});

const eCommerceApiStack = new ECommerceApiStack(app, "ECommerceApi", {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  productsAdminHandler: productsAppStack.productsAdminHandler,
  ordersHandler: ordersAppStack.ordersHandler,
  ordersEventsFetchHandler: ordersAppStack.ordersEventsFetchHandler,
  tags: tags,
  env: env,
});

eCommerceApiStack.addDependency(productsAppStack);

const invoicesAppLayersStack = new InvoicesAppLayersStack(
  app,
  "InvoicesAppLayersStack",
  {
    tags: {
      cost: "InvoicesApp",
      team: "Ruffos",
    },
    env: env,
  }
);

const invoiceWSApiStack = new InvoiceWSApiStack(app, "InvoiceApi", {
  eventsDdb: eventsDdbStack.table,
  auditBus: auditEventBusStack.bus,
  tags: {
    cost: "InvoicesApp",
    team: "Ruffos",
  },
  env: env,
});

invoiceWSApiStack.addDependency(invoicesAppLayersStack);
invoiceWSApiStack.addDependency(eventsDdbStack);
invoiceWSApiStack.addDependency(auditEventBusStack);
