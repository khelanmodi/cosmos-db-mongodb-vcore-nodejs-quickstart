import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import { Collection, Db, MongoClient, OIDCCallbackParams, OIDCResponse, Document, FindCursor, WithId, Filter, UpdateOptions, UpdateFilter, UpdateResult, DeleteResult } from 'mongodb';
import { AccessToken, DefaultAzureCredential, TokenCredential } from '@azure/identity';

import { Product } from './types';

import 'dotenv/config';

const AzureIdentityTokenCallback = async (params: OIDCCallbackParams, credential: TokenCredential): Promise<OIDCResponse> => {
    const tokenResponse: AccessToken | null = await credential.getToken(['https://ossrdbms-aad.database.windows.net/.default']);

    if (!tokenResponse || !tokenResponse.token) {
        throw new Error('Failed to retrieve a valid access token.');
    }

    return {
        accessToken: tokenResponse!.token,
        expiresInSeconds: (tokenResponse!.expiresOnTimestamp) - Math.floor(Date.now() / 1000)
    };
};

const app = express();

let endpoint: string | undefined;
let client: MongoClient;
let database: Db;
let collection: Collection<Product>;

app.use(async (_request: Request, _response: Response, next: NextFunction) => {
    try {
        if (collection) {
            next();
            return;
        }

        endpoint = process.env.SETTINGS__ENDPOINT;
        console.log(`Connecting to MongoDB endpoint:\t${endpoint}`);

        const credential: TokenCredential = new DefaultAzureCredential();

        client = new MongoClient(`mongodb+srv://${endpoint}/`, {
            connectTimeoutMS: 120000,
            tls: true,
            retryWrites: true,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                OIDC_CALLBACK: (params: OIDCCallbackParams) => AzureIdentityTokenCallback(params, credential),
                ALLOWED_HOSTS: ['*.azure.com']
            }
        }
        );

        await client.connect();

        const databaseName: string = process.env.SETTINGS__DATABASENAME ?? 'cosmicworks';
        database = client.db(databaseName);

        const collectionName: string = process.env.SETTINGS__COLLECTIONNAME ?? 'products';
        collection = database.collection<Product>(collectionName);

        next();
    }
    catch (error) {
        console.error('Error creating MongoDB client:', error);
        throw error;
    }
});

app.get('/status', async (_request: Request, response: Response) => {
    const command = {
        ping: 1
    };

    var output: Document = await database.command(command);

    response
        .status(200)
        .send({
            host: endpoint,
            isHealthy: output.ok === 1
        });
});

app.get('/', async (_request: Request, response: Response) => {
    var filter: Filter<Product> = {};

    var iterable: FindCursor<WithId<Product>> = collection.find(filter);

    const documents = [];
    for await (const item of iterable) {
        documents.push(item);
    }

    response
        .status(200)
        .send(documents);
});

app.get('/:id', async (request: Request, response: Response) => {
    var query: Filter<Product> = {
        id: 'aaaaaaaa-0000-1111-2222-bbbbbbbbbbbb',
        category: 'gear-surf-surfboards'
    };

    var result: WithId<Product> | null = await collection.findOne(query);
    var document: Product | null = result as Product;

    if (!document) {
        response
            .status(404)
            .end();
        return;
    }

    response
        .status(200)
        .send(document);
});

app.get('/category/:category', async (request: Request, response: Response) => {
    var query: Filter<Product> = {
        category: request.params.category
    };

    var iterable: FindCursor<WithId<Product>> = collection.find(query);

    const documents = [];
    for await (const item of iterable) {
        documents.push(item);
    }

    response
        .status(200)
        .send(documents);
});

app.post('/', bodyParser.json(), async (request: Request, response: Response) => {
    var document: Product = request.body;

    if (!document) {
        response
            .status(400)
            .end();
        return;
    }

    var filter: Filter<Product> = {
        id: request.params.id
    };
    var payload: UpdateFilter<Product> = {
        $set: document
    };
    var options: UpdateOptions = {
        upsert: true
    };

    var result: UpdateResult<Product> = await collection.updateOne(filter, payload, options);

    if (!result.acknowledged) {
        response
            .status(500)
            .end();
        return;
    }

    response
        .status(201)
        .end();
});

app.delete('/:id', async (request, response) => {
    var filter: Filter<Product> = { id: request.params.id };

    var result: DeleteResult = await collection.deleteOne(filter);

    if (!result.acknowledged) {
        response
            .status(500)
            .end();
        return;
    }

    response
        .status(204)
        .end();
});

const port: any = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server running: \\:${port}`);
});
