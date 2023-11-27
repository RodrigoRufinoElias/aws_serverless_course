import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { v4 as uuid } from "uuid";

// Interace representacional da tabela PRODUCT
export interface Product {
    id: string;
    productName: string;
    code: string;
    price: string;
    model: string;
    productUrl: string;
}

// Lib do Product Layer
export class ProductRepository {
    private ddbClient: DocumentClient;
    private productDdb: string;

    constructor(ddbClient: DocumentClient, productDdb: string) {
        this.ddbClient = ddbClient;
        this.productDdb = productDdb;
    }

    // Não é recomendado usa SCAN para buscar tudo, pois é muito custoso.
    async getAllProducts(): Promise<Product[]> {
        const data = await this.ddbClient.scan({
            TableName: this.productDdb
        }).promise();

        return data.Items as Product[];
    }

    async getProductById(productId: string): Promise<Product> {
        const data = await this.ddbClient.get({
            TableName: this.productDdb,
            Key: {
                id: productId
            }
        }).promise();

        if (data.Item) {
            return data.Item as Product;
        } else {
            throw new Error("Product not found");
        }
    }

    async createProduct(product: Product): Promise<Product> {
        product.id = uuid();

        await this.ddbClient.put({
            TableName: this.productDdb,
            Item: product
        }).promise();

        return product;
    }

    async deleteProduct(productId: string): Promise<Product> {
        const data = await this.ddbClient.delete({
            TableName: this.productDdb,
            Key: {
                id: productId
            },
            // Para retornar tbm os valores anteriores ao delete.
            ReturnValues: "ALL_OLD"
        }).promise();

        // Verifica se os valores anteriores existem.
        if (data.Attributes) {
            return data.Attributes as Product;
        } else {
            throw new Error("Product not found");
        }
    }

    async updateProduct(productId: string, product: Product): Promise<Product> {
        const data = await this.ddbClient.update({
            TableName: this.productDdb,
            Key: {
                id: productId
            },
            ConditionExpression: "attribute_exists(id)",
            ReturnValues: "UPDATED_NEW",
            UpdateExpression: "set productName = :n, code = :c, price = :p, model = :m, productUrl = :u",
            ExpressionAttributeValues: {
                ":n": product.productName,
                ":c": product.code,
                ":p": product.price,
                ":m": product.model,
                ":u": product.productUrl,
            }
        }).promise();

        data.Attributes!.id = productId;

        return data.Attributes as Product;
    }
}