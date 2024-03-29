export enum PaymentType {
  CASH = "CASH",
  DEBIT_CARD = "DEBIT_CARD",
  CREDIT_CARD = "CREDIT_CARD",
}

export enum ShippingType {
  ECONOMIC = "ECONOMIC",
  URGENT = "URGENT",
}

export enum CarrierType {
  CORREIOS = "CORREIOS",
  FEDEX = "FEDEX",
}

export interface OrderRequest {
  email: string;
  productIds: string[];
  payment: PaymentType;
  shipping: {
    type: ShippingType;
    carrier: CarrierType;
  };
}

export interface OrderProductResponse {
  code: string;
  price: number;
}

export interface OrderResponse {
  id: string;
  email: string;
  createdAt: number;
  billing: {
    payment: PaymentType;
    totalPrice: number;
  };
  shipping: {
    type: ShippingType;
    carrier: CarrierType;
  };
  products?: OrderProductResponse[];
}
