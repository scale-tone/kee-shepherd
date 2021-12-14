import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';

// Implements picking and retrieving secret values from Azure Redis Cache
export class AzureRedisSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
        const token = await tokenCredentials.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        const key = response.data[secret.properties.keyName];

        if (!!secret.properties.connectionString) {
            return `${secret.properties.connectionString}password=${key}`;
        }

        return key;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId);

        const instanceId = await this.pickUpInstanceId(subscriptionId, tokenCredentials);

        if (!instanceId) {
            return;
        }

        // Obtaining default token
        const token = await tokenCredentials.getToken();

        const instanceUri = `https://management.azure.com${instanceId}?api-version=2020-06-01`;
        const instanceResponse = await axios.get(instanceUri, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        const instanceName = instanceResponse.data?.name;
        const hostName = instanceResponse.data?.properties?.hostName;
        const sslPort = instanceResponse.data?.properties?.sslPort;

        const connString = `${hostName}:${sslPort},ssl=True,abortConnect=False,`;

        const keysUri = `https://management.azure.com${instanceId}/listKeys?api-version=2020-06-01`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });
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
                    value: `${connString}password=${keys[keyName]}`,
                    connString: connString
                }
            ];
        });

        const selectedOption = await vscode.window.showQuickPick(options.flat(), { title: 'Select Azure Redis Cache Secret' });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureRedisCache,
            name: `${instanceName}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: selectedOption.keyName,
                connectionString: selectedOption.connString
            }
        }
    }

    private async pickUpInstanceId(subscriptionId: string, credentials: DeviceTokenCredentials): Promise<string> {

        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.cache/redis"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Redis Cache instances found in this subscription');
        }

        const instances: { id: string, name: string, location: string }[] = response.data;

        const pickResult = await vscode.window.showQuickPick(
            instances.map(n => {
                return {
                    label: n.name,
                    description: `location: ${n.location}`,
                    id: n.id
                };
            }),
            { title: 'Select Azure Redis Cache instance' }
        );

        return !!pickResult ? pickResult.id : '';
    }    
} 
