import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Redis Cache
export class AzureRedisSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    isMyResourceId(resourceId: string): boolean { return !!this.parseResourceId(resourceId); }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const key = response.data[secret.properties.keyName];

        if (!!secret.properties.connectionString) {
            return `${secret.properties.connectionString}password=${key}`;
        }

        return key;
    }

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {

        let subscriptionId: string | undefined;

        if (!!resourceId) {

            const parseResult = this.parseResourceId(resourceId);

            if (!parseResult) {
                return;
            }

            ({ subscriptionId } = parseResult);

        } else {

            const subscription = await this._account.pickUpSubscription();
            if (!subscription) {
                return;
            }
    
            subscriptionId = subscription.subscriptionId;
    
            resourceId = await this.pickUpInstanceId(subscriptionId);
    
            if (!resourceId) {
                return;
            }
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const instanceUri = `https://management.azure.com${resourceId}?api-version=2020-06-01`;
        const instanceResponse = await axios.get(instanceUri, { headers: { 'Authorization': `Bearer ${token}` } });

        const instanceName = instanceResponse.data?.name;
        const hostName = instanceResponse.data?.properties?.hostName;
        const sslPort = instanceResponse.data?.properties?.sslPort;

        const connString = `${hostName}:${sslPort},ssl=True,abortConnect=False,`;

        const keysUri = `https://management.azure.com${resourceId}/listKeys?api-version=2020-06-01`;
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
        };
    }

    private async pickUpInstanceId(subscriptionId: string): Promise<string> {

        const credentials = await this._account.getTokenCredential();
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

    private parseResourceId(resourceId: string): { subscriptionId: string } | undefined {

        const match = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.cache\/redis\/([^\/]+)$/gi.exec(resourceId);
        
        return !match ? undefined : {
            subscriptionId: match[1]
        };
    }
} 
