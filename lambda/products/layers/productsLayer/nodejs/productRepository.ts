import { DocumentClient } from "aws-sdk/clients/dynamodb";
import { v4 as uuid } from "uuid";

// Interace representacional da tabela PRODUCT
export interface Product {
    id: string;
    productName: string;
    code: string;
    price: string;
    model: string;
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
}