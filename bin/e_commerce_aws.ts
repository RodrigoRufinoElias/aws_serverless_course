#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ProductsAppStack } from '../lib/productsApp-stack';
import { ECommerceApiStack } from '../lib/ecommerceApi-stack';
import { ProductAppLayersStack } from '../lib/ProductsAppLayers-stack';

const app = new cdk.App();

// Env da conta AWS. Varia caso use ambientes diferentes.
const env: cdk.Environment = {
  account: "098297762675",
  region: "us-east-1"
};

// Tags para controle. É importante customizar!
const tags = {
  cost: "ECommerce",
  team: "Ruffos"
};

const productAppLayersStack = new ProductAppLayersStack(app, "ProductsAppLayers", {
  tags: tags,
  env: env
});

const productsAppStack = new ProductsAppStack(app, "ProductsApp", {
  tags: tags,
  env: env
});

productsAppStack.addDependency(productAppLayersStack);

const eCommerceApiStack = new ECommerceApiStack(app, "ECommerceApi", {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  productsAdminHandler: productsAppStack.productsAdminHandler,
  tags: tags,
  env: env
});

eCommerceApiStack.addDependency(productsAppStack);