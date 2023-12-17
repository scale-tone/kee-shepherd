import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Event Hubs
export class EventHubSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const keys = this.resourceManagerResponseToKeys(response.data);
        const key = keys.find(k => k.label === secret.properties.keyName)?.value ?? '';

        return key;
    }

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {

        let subscriptionId: string | undefined, namespaceName: string | undefined;

        if (!!resourceId) {

            const resourceIdMatch = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.eventhub\/namespaces\/(.+)/gi.exec(resourceId);
            if (!resourceIdMatch) {
                return;
            }

            subscriptionId = resourceIdMatch[1];
            namespaceName = resourceIdMatch[3];

        } else {

            const subscription = await this._account.pickUpSubscription();
            if (!subscription) {
                return;
            }
    
            subscriptionId = subscription.subscription.subscriptionId;
    
            const namespace = await this.pickUpEventHubNamespaceId(subscriptionId);
    
            if (!namespace) {
                return;
            }

            resourceId = namespace.id;
            namespaceName = namespace.name;
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const promise = Promise.all([
            this.getRootAuthRules(resourceId, token),
            this.getHubAuthRules (resourceId, token)
        ]);

        const authRules = (await promise).flat();

        if (authRules.length < 0) {
            return;
        }

        const authRule = await vscode.window.showQuickPick(authRules, { title: `Select ${namespaceName} Authorization Rule to use` });
        if (!authRule) {
            return;
        }

        const keysUri = `https://management.azure.com${resourceId}/${authRule}/listKeys?api-version=2017-04-01`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });
        
        const keys = this.resourceManagerResponseToKeys(keysResponse.data);
        if (keys.length < 0) {
            return;
        }
        
        const key = await vscode.window.showQuickPick(keys, { title: 'Select which key to use' });

        if (!key) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureEventHubs,
            name: `${namespaceName}-${key.label}`,
            value: key.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: key.label
            }
        };
    }


    private async getRootAuthRules(namespaceId: string, accessToken: string): Promise<string[]> {

        const uri = `https://management.azure.com${namespaceId}/authorizationRules?api-version=2017-04-01`;
        const response = await axios.get(uri, { headers: { 'Authorization': `Bearer ${accessToken}` } });

        if (!response.data?.value) {

            return [];
        }

        return response.data.value.map((r: any) => `authorizationRules/${r.name}`);
    }

    private async getHubAuthRules(namespaceId: string, accessToken: string): Promise<string[]> {

        const uri = `https://management.azure.com${namespaceId}/eventhubs?api-version=2017-04-01`;
        const response = await axios.get(uri, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const itemNames: string[] = response.data?.value?.map((t: any) => t.name);

        if (!itemNames) { 
            return [];
        }

        const promises = itemNames.map(itemName => {

            const authRulesUri = `https://management.azure.com${namespaceId}/eventhubs/${itemName}/authorizationRules?api-version=2017-04-01`;
            return axios
                .get(authRulesUri, { headers: { 'Authorization': `Bearer ${accessToken}` } })
                .then(authRulesResponse => { 

                    if (!authRulesResponse.data?.value) {
                        return [];
                    }

                    return authRulesResponse.data?.value?.map((r: any) => `eventhubs/${itemName}/authorizationRules/${r.name}`) as string[];
                });
        })

        return (await Promise.all(promises)).flat().sort();
    }
    
    private resourceManagerResponseToKeys(data: any): { label: string, value: string }[] {
        
        if (!data) {
            return [];
        }

        return Object.keys(data).filter(n => n !== 'keyName').map(n => { return { label: n, value: data[n] }; });
    }

    private async pickUpEventHubNamespaceId(subscriptionId: string): Promise<{ name: string, id: string } | undefined> {

        const credentials = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.eventhub/namespaces"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Event Hubs namespaces found in this subscription');
        }

        const namespaces: { id: string, name: string, sku: any, location: string }[] = response.data;

        const pickResult = await vscode.window.showQuickPick(
            namespaces.map(n => {
                return {
                    label: n.name,
                    description: `location: ${n.location}, SKU: ${n.sku?.name}`,
                    id: n.id
                };
            }),
            { title: 'Select Azure Event Hubs namespace' }
        );

        if (!!pickResult) {
            
            return {
                name: pickResult.label,
                id: pickResult.id
            }
        }
    }    
} 
