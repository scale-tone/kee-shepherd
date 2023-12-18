import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Search
export class AzureSearchSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    isMyResourceId(resourceId: string): boolean { return !!this.parseResourceId(resourceId); }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const keys = this.resourceManagerResponseToKeys(response.data);

        if (keys.length < 0) {
            return '';
        }
        
        const key = keys.find(k => (!k.name && !secret.properties.keyName) || (k.name === secret.properties.keyName));
        return !!key ? key.key : '';
    }

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {

        let subscriptionId: string | undefined, serviceName: string | undefined;
        let isAdminKey: boolean;

        if (!!resourceId) {

            const parseResult = this.parseResourceId(resourceId);

            if (!parseResult) {
                return;
            }

            ({ subscriptionId, serviceName} = parseResult);

            const userResponse = await vscode.window.showQuickPick(['Query Keys', 'Admin Keys'], { title: 'Which keys to use?' });
            if (!userResponse) {
                return;
            }

            isAdminKey = userResponse === 'Admin Keys';
            
        } else {

            const subscription = await this._account.pickUpSubscription();
            if (!subscription) {
                return;
            }
    
            const subscriptionId = subscription.subscription.subscriptionId;
    
            const service = await this.pickUpService(subscriptionId);
    
            if (!service) {
                return;
            }

            resourceId = service.id;
            serviceName = service.name;
            isAdminKey = service.isAdminKey;
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const keysUri = `https://management.azure.com${resourceId}/${isAdminKey ? 'listAdminKeys' : 'listQueryKeys'}?api-version=2020-08-01`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const keys = this.resourceManagerResponseToKeys(keysResponse.data);

        if (keys.length < 0) {
            return;
        }

        if (keys.length === 1) {

            return {
                type: SecretTypeEnum.AzureSearch,
                name: `${serviceName}-${!isAdminKey ? 'queryKey' : 'adminKey'}`,
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

        const selectedOption = await vscode.window.showQuickPick(options, { title: `Select Key from ${serviceName}` });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureSearch,
            name: `${serviceName}-${selectedOption.label}`,
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

    private async pickUpService(subscriptionId: string): Promise<{ id: string, name: string, isAdminKey: boolean } | undefined> {

        const credentials = await this._account.getTokenCredential();
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

    private parseResourceId(resourceId: string): { subscriptionId: string, serviceName: string } | undefined {

        const match = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.search\/searchservices\/(.+)/gi.exec(resourceId);
        
        return !match ? undefined : {
            subscriptionId: match[1],
            serviceName: match[3]
        };
    }
} 
