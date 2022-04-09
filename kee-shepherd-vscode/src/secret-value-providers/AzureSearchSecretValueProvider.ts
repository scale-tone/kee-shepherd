import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';

// Implements picking and retrieving secret values from Azure Search
export class AzureSearchSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
        const token = await tokenCredentials.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        const keys = this.resourceManagerResponseToKeys(response.data);

        if (keys.length < 0) {
            return '';
        }
        
        const key = keys.find(k => (!k.name && !secret.properties.keyName) || (k.name === secret.properties.keyName));
        return !!key ? key.key : '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId);

        const service = await this.pickUpService(subscriptionId, tokenCredentials);

        if (!service) {
            return;
        }

        // Obtaining default token
        const token = await tokenCredentials.getToken();

        const keysUri = `https://management.azure.com${service.id}/${service.isAdminKey ? 'listAdminKeys' : 'listQueryKeys'}?api-version=2020-08-01`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        const keys = this.resourceManagerResponseToKeys(keysResponse.data);

        if (keys.length < 0) {
            return;
        }

        if (keys.length === 1) {

            return {
                type: SecretTypeEnum.AzureSearch,
                name: `${service.name}-${!service.isAdminKey ? 'queryKey' : 'adminKey'}`,
                value: keys[0].key,
                properties: {
                    subscriptionId,
                    resourceManagerUri: keysUri,
                    keyName: keys[0].name
                }
            };
        }

        const options = keys.map(key => {
            
            return {
                label: key.name ?? '[Default]',
                value: key.key,
                isDefault: !key.name
            };

        });

        const selectedOption = await vscode.window.showQuickPick(options, { title: `Select Key from ${service.name}` });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureSearch,
            name: `${service.name}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: !selectedOption.isDefault ? selectedOption.label : ''
            }
        };
    }

    private resourceManagerResponseToKeys(data: any): { name: string, key: string }[] {
        
        if (!data) {
            return [];
        }

        if (!!data.value && (data.value.length >= 0)) {
            return data.value;
        }

        return Object.keys(data).map(n => { return { name: n, key: data[n] }; });
    }

    private async pickUpService(subscriptionId: string, credentials: DeviceTokenCredentials): Promise<{ id: string, name: string, isAdminKey: boolean } | undefined> {

        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.search/searchservices"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Azure Search services found in this subscription');
        }

        const instances: { id: string, name: string, location: string }[] = response.data;

        const pickResult = await vscode.window.showQuickPick(
            
            instances
                .map(n => {
                    return [
                        {
                            name: n.name,
                            label: `${n.name} - Query Keys`,
                            description: `location: ${n.location}`,
                            id: n.id,
                            isAdminKey: false
                        },
                        {
                            name: n.name,
                            label: `${n.name} - Admin Keys`,
                            description: `location: ${n.location}`,
                            id: n.id,
                            isAdminKey: true
                        }
                    ];
                })
                .flat(),

            { title: 'Select Azure Search service and key type' }
        );

        if (!!pickResult) {
            
            return {
                id: pickResult.id,
                name: pickResult.name,
                isAdminKey: pickResult.isAdminKey
            };
        }
    }    
} 
