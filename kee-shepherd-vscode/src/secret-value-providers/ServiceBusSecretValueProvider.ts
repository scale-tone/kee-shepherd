import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper, AzureSubscription } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Service Bus
export class ServiceBusSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
        const token = await tokenCredentials.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        const keys = this.resourceManagerResponseToKeys(response.data);
        if (!keys) {
            return '';
        }

        return keys.find(k => k.label === secret.properties.keyName)?.value ?? '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;

        const namespaceId = await ServiceBusSecretValueProvider.pickUpServiceBusNamespaceId(subscription);

        if (!namespaceId) {
            return;
        }

        // Obtaining default token
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId);
        const token = await tokenCredentials.getToken();

        const uri = `https://management.azure.com${namespaceId}/AuthorizationRules/RootManageSharedAccessKey/listKeys?api-version=2017-04-01`;

        const response = await axios.post(uri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });
        
        const keys = this.resourceManagerResponseToKeys(response.data);
        if (!keys) {
            return;
        }
        
        const key = await vscode.window.showQuickPick(keys, { title: 'Select which key to use' });

        if (!key) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureServiceBus,
            name: key.label,
            value: key.value,
            properties: {
                subscriptionId,
                resourceManagerUri: uri,
                keyName: key.label
            }
        };
    }

    private resourceManagerResponseToKeys(data: any): { label: string, value: string }[] | undefined {
        
        if (!data) {
        
            return;
        
        }

        return Object.keys(data).filter(n => n !== 'keyName').map(n => { return { label: n, value: data[n] }; });
    }

    static async pickUpServiceBusNamespaceId(subscription: AzureSubscription): Promise<string> {

        const resourceGraphClient = new ResourceGraphClient(subscription.session.credentials2);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscription.subscription.subscriptionId],
            query: 'resources | where type == "microsoft.servicebus/namespaces"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Service Bus namespaces found in this subscription');
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
            { title: 'Select Azure Service Bus namespace' }
        );

        return !!pickResult ? pickResult.id : '';
    }    
} 
