import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cwlogs from "aws-cdk-lib/aws-logs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface ECommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJS.NodejsFunction;
  productsAdminHandler: lambdaNodeJS.NodejsFunction;
  ordersHandler: lambdaNodeJS.NodejsFunction;
  ordersEventsFetchHandler: lambdaNodeJS.NodejsFunction;
}

// Stack para criação de API Gateway e integrar
// com as Lambda functions
export class ECommerceApiStack extends cdk.Stack {
  private productsAuthorizer: apigateway.CognitoUserPoolsAuthorizer;
  private productsAdminAuthorizer: apigateway.CognitoUserPoolsAuthorizer;
  private customerPool: cognito.UserPool;
  private adminPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: ECommerceApiStackProps) {
    super(scope, id, props);

    const logGroup = new cwlogs.LogGroup(this, "ECommerceAPILogs");
    const api = new apigateway.RestApi(this, "EcommerceAPI", {
      restApiName: "EcommerceAPI",
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          caller: true,
          user: true,
        }),
      },
    });

    this.createCognitoAuth();

    // Police para permitir o acesso da função de produtos ao Admin Pool
    const adminUserPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: [this.adminPool.userPoolArn],
    });

    // Gambi p/ anexar a policy ao "productsAdminHandler" pois, aqui, o lambda já foi criado
    const adminUserPolicy = new iam.Policy(this, "AdminGetUserPolicy", {
      statements: [adminUserPolicyStatement],
    });
    adminUserPolicy.attachToRole(<iam.Role>props.productsAdminHandler.role);

    this.createProductsService(props, api);
    this.createOrdersService(props, api);
  }

  private createCognitoAuth() {
    // Lambda invocada após a confirmação de usuário
    const postConfirmationHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "PostConfirmationFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "PostConfirmationFunction",
        entry: "lambda/auth/postConfirmationFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Lambda invocada antes da autenticação de usuário
    const preAuthenticatorHandler = new lambdaNodeJS.NodejsFunction(
      this,
      "PreAuthenticatorFunction",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: "PreAuthenticatorFunction",
        entry: "lambda/auth/preAuthenticatorFunction.ts",
        handler: "handler",
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        // Habilita o log Tracing das funções lambda pelo XRay.
        tracing: lambda.Tracing.ACTIVE,
        // Habilita o Lambda Insight
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0,
      }
    );

    // Customer User Pool
    this.customerPool = new cognito.UserPool(this, "CustomerPool", {
      // Integra lambdas com ações do Cognito
      lambdaTriggers: {
        // Chama lambda antes da autenticação
        preAuthentication: preAuthenticatorHandler,
        // Chama lambda após criação de usuário
        postConfirmation: postConfirmationHandler,
      },
      userPoolName: "CustomerPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
        phone: false,
      },
      userVerification: {
        emailSubject: "Verify your email for the ECommerce service!",
        emailBody:
          "Thanks for signing up to ECommerce service! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInAliases: {
        username: false,
        email: true,
      },
      standardAttributes: {
        fullname: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    // Admin User Pool
    this.adminPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: "AdminPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      userInvitation: {
        emailSubject: "Welcome to the ECommerce administrator service!",
        emailBody: "You username is {username} nd temporary password is {####}",
      },
      signInAliases: {
        username: false,
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    // Add domínio p/ o Customer User Pool
    this.customerPool.addDomain("CustomerDomain", {
      cognitoDomain: {
        domainPrefix: "rre-course-customer-service",
      },
    });

    // Add domínio p/ o Admin User Pool
    this.adminPool.addDomain("AdminDomain", {
      cognitoDomain: {
        domainPrefix: "rre-course-admin-service",
      },
    });

    // Customer Web Scope (operações que o Customer Pool pode acessar pela web)
    const customerWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Customer Web Operation",
    });

    // Customer Mobile Scope (operações que o Customer Pool pode acessar por mobile)
    const customerMobileScope = new cognito.ResourceServerScope({
      scopeName: "mobile",
      scopeDescription: "Customer Mobile Operation",
    });

    // Admin Web Scope (operações que o Admin Pool pode acessar pela web)
    const adminWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Admin Web Operation",
    });

    // Customer Resource Server (integração com os Customer Scopes)
    // (servidor que permite o acesso aos recursos para os usuários do Customer User Pool)
    const customerResourceServer = this.customerPool.addResourceServer(
      "CustomerResourceServer",
      {
        identifier: "customer",
        userPoolResourceServerName: "CustomerResourceServer",
        scopes: [customerWebScope, customerMobileScope],
      }
    );

    // Admin Resource Server (integração com os Admin Scopes)
    // (servidor que permite o acesso aos recursos para os usuários do Admin User Pool)
    const adminResourceServer = this.adminPool.addResourceServer(
      "AdminResourceServer",
      {
        identifier: "admin",
        userPoolResourceServerName: "AdminResourceServer",
        scopes: [adminWebScope],
      }
    );

    // Customer Web Client (Identificação para os usuários no Web Pool)
    this.customerPool.addClient("customer-web-client", {
      userPoolClientName: "CustomerWebClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(
            customerResourceServer,
            customerWebScope
          ),
        ],
      },
    });

    // Customer Mobile Client (Identificação para os usuários no Mobile Pool)
    this.customerPool.addClient("customer-mobile-client", {
      userPoolClientName: "CustomerMobileClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(
            customerResourceServer,
            customerMobileScope
          ),
        ],
      },
    });

    // Admin Web Client (Identificação para os usuários no Admin Web Pool)
    this.adminPool.addClient("admin-web-client", {
      userPoolClientName: "adminWebClient",
      authFlows: {
        userPassword: true,
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [
          cognito.OAuthScope.resourceServer(adminResourceServer, adminWebScope),
        ],
      },
    });

    // Configura o Authorizer para o Customer Pool
    // (permite associar os escopos do Customer Pool com as funcionalidades de Products)
    this.productsAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "ProductsAuthorizer",
      {
        authorizerName: "ProductsAuthorizer",
        cognitoUserPools: [this.customerPool, this.adminPool],
      }
    );

    // Configura o Authorizer para o Admin Pool
    // (permite associar os escopos do Admin Pool com as funcionalidades de Products)
    this.productsAdminAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "ProductsAdminAuthorizer",
      {
        authorizerName: "ProductsAdminAuthorizer",
        cognitoUserPools: [this.adminPool],
      }
    );
  }

  private createProductsService(
    props: ECommerceApiStackProps,
    api: apigateway.RestApi
  ) {
    // Integração do API Gateway com o Lambda "productsFetchHandler"
    const productsFetchIntegration = new apigateway.LambdaIntegration(
      props.productsFetchHandler
    );
    // Integração do API Gateway com o Lambda "productsAdminHandler"
    const productsAdminIntegration = new apigateway.LambdaIntegration(
      props.productsAdminHandler
    );

    // Config para integrar o autorizador "productsAuthorizer" com os escopos web e mobile
    const productsFetchWebMobileIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      // identifier do "ResourceServer" + scopeName
      authorizationScope: ["customer/web", "customer/mobile", "admin/web"],
    };

    // Config para integrar o autorizador "productsAuthorizer" com os escopos web
    const productsFetchWebIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      // identifier do "ResourceServer" + scopeName
      authorizationScope: ["customer/web", "admin/web"],
    };

    // Add o endpoint "/products" no API Gateway
    const productsResource = api.root.addResource("products");
    // Add o endpoint "/products/{id}" no API Gateway
    const productIdResource = productsResource.addResource("{id}");

    // Adiciona ao endpoint "/products" o método GET, a integração do "productsFetchIntegration"
    // e o Authorizer do Cognito
    productsResource.addMethod(
      "GET",
      productsFetchIntegration,
      productsFetchWebMobileIntegrationOption
    );
    // Adiciona ao endpoint "/products/{id}" o método GET, a integração do "productsFetchIntegration"
    // e o Authorizer do Cognito
    productIdResource.addMethod(
      "GET",
      productsFetchIntegration,
      productsFetchWebIntegrationOption
    );

    // Monta o Validator para o body do /products
    const productRequestValidator = new apigateway.RequestValidator(
      this,
      "ProductRequestValidator",
      {
        restApi: api,
        requestValidatorName: "Product request validator",
        validateRequestBody: true,
      }
    );

    // Modelo Product para validação
    const productModel = new apigateway.Model(this, "ProductModel", {
      modelName: "ProductModel",
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          productName: {
            type: apigateway.JsonSchemaType.STRING,
          },
          code: {
            type: apigateway.JsonSchemaType.STRING,
          },
          price: {
            type: apigateway.JsonSchemaType.INTEGER,
          },
          model: {
            type: apigateway.JsonSchemaType.STRING,
          },
          productUrl: {
            type: apigateway.JsonSchemaType.STRING,
          },
        },
        required: ["productName", "code", "price", "model", "productUrl"],
      },
    });

    // Adiciona ao endpoint "/products" o método POST
    // e a integração do "productsAdminIntegration"
    productsResource.addMethod("POST", productsAdminIntegration, {
      requestValidator: productRequestValidator,
      requestModels: {
        "application/json": productModel,
      },
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });
    // Adiciona ao endpoint "/products/{id}" o método PUT
    // e a integração do "productsAdminIntegration"
    productIdResource.addMethod("PUT", productsAdminIntegration, {
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });
    // Adiciona ao endpoint "/products/{id}" o método DELETE
    // e a integração do "productsAdminIntegration"
    productIdResource.addMethod("DELETE", productsAdminIntegration, {
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ["admin/web"],
    });
  }

  private createOrdersService(
    props: ECommerceApiStackProps,
    api: apigateway.RestApi
  ) {
    // Integração do API Gateway com o Lambda "ordersHandler"
    const ordersIntegration = new apigateway.LambdaIntegration(
      props.ordersHandler
    );

    // Integração do API Gateway com o Lambda "ordersEventsFetchHandler"
    const ordersEventsIntegration = new apigateway.LambdaIntegration(
      props.ordersEventsFetchHandler
    );

    // Add o endpoint "/orders" no API Gateway
    const ordersResource = api.root.addResource("orders");

    // Add o endpoint "/orders/events" no API Gateway
    const ordersEventsResource = ordersResource.addResource("events");

    // Adiciona ao endpoint "/orders" o método GET
    // e a integração do "ordersIntegration"
    ordersResource.addMethod("GET", ordersIntegration);

    // Monta o Validator para as querystrings do DELETE
    const orderDeletionvalidator = new apigateway.RequestValidator(
      this,
      "OrderDeletionvalidator",
      {
        restApi: api,
        requestValidatorName: "OrderDeletionvalidator",
        validateRequestParameters: true,
      }
    );

    // Adiciona ao endpoint "/orders" o método DELETE,
    // obrigando a enviar como querystring os attrs email e orderId
    // e a integração do "ordersIntegration"
    ordersResource.addMethod("DELETE", ordersIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.orderId": true,
      },
      requestValidator: orderDeletionvalidator,
    });

    // Monta o Validator para o body do POST /orders
    const orderRequestValidator = new apigateway.RequestValidator(
      this,
      "OrderRequestValidator",
      {
        restApi: api,
        requestValidatorName: "Order request validator",
        validateRequestBody: true,
      }
    );

    // Modelo Order para validação
    const orderModel = new apigateway.Model(this, "OrderModel", {
      modelName: "OrderModel",
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          email: {
            type: apigateway.JsonSchemaType.STRING,
          },
          productIds: {
            type: apigateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: {
              type: apigateway.JsonSchemaType.STRING,
            },
          },
          payment: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ["CASH", "DEBIT_CARD", "CREDIT_CARD"],
          },
        },
        required: ["email", "productIds", "payment"],
      },
    });

    // Adiciona ao endpoint "/orders" o método POST
    // e a integração do "ordersIntegration"
    ordersResource.addMethod("POST", ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: {
        "application/json": orderModel,
      },
    });

    // Monta o Validator para as querystrings do Order Events Fetch
    const orderEventsFetchValidator = new apigateway.RequestValidator(
      this,
      "OrderEventsFetchValidator",
      {
        restApi: api,
        requestValidatorName: "OrderEventsFetchValidator",
        validateRequestParameters: true,
      }
    );

    // Adiciona ao endpoint "/orders/events" o método GET
    // e a integração do "ordersEventsIntegration"
    ordersEventsResource.addMethod("GET", ordersEventsIntegration, {
      requestParameters: {
        "method.request.querystring.email": true,
        "method.request.querystring.eventType": false,
      },
      requestValidator: orderEventsFetchValidator,
    });
  }
}
