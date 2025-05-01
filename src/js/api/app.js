import express from 'express';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';
import { DefaultAzureCredential } from '@azure/identity';

import 'dotenv/config';

const azureIdentityTokenCallback = async (_, credential) => {
    const tokenResponse = await credential.getToken(['https://ossrdbms-aad.database.windows.net/.default']);

    if (!tokenResponse || !tokenResponse.token) {
        throw new Error('Failed to retrieve a valid access token.');
    }

    return {
        accessToken: tokenResponse.token,
        expiresInSeconds: Math.floor((tokenResponse.expiresOnTimestamp - Date.now()) / 1000),
    };
};

const app = express();

let endpoint;
let client;
let database;
let collection;

app.use(async (_request, _response, next) => {
    try {
        if (collection) {
            next();
            return;
        }

        endpoint = process.env.SETTINGS__ENDPOINT;
        console.log(`Connecting to MongoDB endpoint:\t${endpoint}`);

        const credential = new DefaultAzureCredential();

        client = new MongoClient(`mongodb+srv://${endpoint}/`, {
            connectTimeoutMS: 120000,
            tls: true,
            retryWrites: true,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: {
                OIDC_CALLBACK: (params) => azureIdentityTokenCallback(params, credential),
                ALLOWED_HOSTS: ['*.azure.com']
            }
        });

        await client.connect();

        const databaseName = process.env.SETTINGS__DATABASENAME ?? 'cosmicworks';
        database = client.db(databaseName);

        const collectionName = process.env.SETTINGS__COLLECTIONNAME ?? 'products';
        collection = database.collection(collectionName);

        next();
    }
    catch (error) {
        console.error('Error creating MongoDB client:', error);
        throw error;
    }
});

app.get('/status', async (_request, response) => {
    const command = {
        ping: 1
    };

    var output = await database.command(command);

    response
        .status(200)
        .send({
            host: endpoint,
            isHealthy: output.ok === 1
        });
});

app.get('/', async (_request, response) => {
    var filter = {};
    var projection = {
        _id: 0,
        id: 1,
        category: 1,
        name: 1,
        quantity: 1,
        price: 1,
        clearance: 1
    }

    var iterable = collection.find(filter).project(projection);

    const documents = [];
    for await (const item of iterable) {
        documents.push(item);
    }

    response
        .status(200)
        .send(documents);
});

app.get('/:id', async (request, response) => {
    const filter = { id: request.params.id };
    var options = {
        projection: {
            _id: 0,
            id: 1,
            category: 1,
            name: 1,
            quantity: 1,
            price: 1,
            clearance: 1
        }
    };

    var document = await collection.findOne(filter, options);

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

app.get('/category/:category', async (request, response) => {
    const filter = { 
        category: request.params.category 
    };
    var options = {
        projection: {
            _id: 0,
            id: 1,
            category: 1,
            name: 1,
            quantity: 1,
            price: 1,
            clearance: 1
        }
    };

    var iterable = await collection.find(filter).project(options.projection);

    const documents = [];
    for await (const item of iterable) {
        documents.push(item);
    }

    response
        .status(200)
        .send(documents);
});

app.post('/', bodyParser.json(), async (request, response) => {
    var document = request.body;

    var filter = { id: request.params.id };
    var payload = {
        $set: document
    };
    var options = {
        upsert: true
    };

    var result = await collection.updateOne(filter, payload, options);

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
    var filter = { id: request.params.id };

    var result = await collection.deleteOne(filter);

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

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server running: \\:${port}`);
});