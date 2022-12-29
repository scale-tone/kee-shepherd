import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Cosmos DB
export class CosmosDbSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const key = response.data[secret.properties.keyName];

        if (!!secret.properties.connectionString) {
            return `${secret.properties.connectionString}AccountKey=${key};`;
        }

        return key;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;

        const accountId = await this.pickUpDatabaseAccountId(subscriptionId);

        if (!accountId) {
            return;
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const accountUri = `https://management.azure.com${accountId}?api-version=2021-10-15`;
        const accountResponse = await axios.get(accountUri, { headers: { 'Authorization': `Bearer ${token}` } });

        const accountName = accountResponse.data?.name;
        const documentEndpoint = accountResponse.data?.properties?.documentEndpoint;

        const connString = `AccountEndpoint=${documentEndpoint};`;

        const keysUri = `https://management.azure.com${accountId}/listKeys?api-version=2021-10-15`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });
        const keys = keysResponse.data;

        if (!keys) {
            return;
        }

        const options = Object.keys(keys).map(keyName => {
            return [
                {
                    label: keyName,
                    keyName: keyName,
                    value: keys[keyName]
                },
                {
                    label: `Connection String with ${keyName}`,
                    keyName: keyName,
                    value: `${connString}AccountKey=${keys[keyName]};`,
                    connString: connString
                }
            ];
        });

        const selectedOption = await vscode.window.showQuickPick(options.flat(), { title: 'Select Cosmos DB Secret' });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureCosmosDb,
            name: `${accountName}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: selectedOption.keyName,
                connectionString: selectedOption.connString
            }
        }
    }

    private async pickUpDatabaseAccountId(subscriptionId: string): Promise<string> {

        const credentials = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.documentdb/databaseaccounts"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Cosmos DB accounts found in this subscription');
        }

        const namespaces: { id: string, name: string, kind: string, location: string }[] = response.data;

        const pickResult = await vscode.window.showQuickPick(
            namespaces.map(n => {
                return {
                    label: n.name,
                    description: `location: ${n.location}, kind: ${n.kind}`,
                    id: n.id
                };
            }),
            { title: 'Select Azure Cosmos DB account' }
        );

        return !!pickResult ? pickResult.id : '';
    }    
} 
