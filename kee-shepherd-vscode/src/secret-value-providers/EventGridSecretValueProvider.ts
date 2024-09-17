import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Event Grid
export class EventGridSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    isMyResourceId(resourceId: string): boolean { return !!this.parseResourceId(resourceId); }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const key = response.data[secret.properties.keyName];
        return key;
    }

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {

        let subscriptionId: string | undefined, topicName: string | undefined;

        if (!!resourceId) {

            const parseResult = this.parseResourceId(resourceId);

            if (!parseResult) {
                return;
            }

            ({ subscriptionId, topicName} = parseResult);

        } else {

            const subscription = await this._account.pickUpSubscription();
            if (!subscription) {
                return;
            }
    
            subscriptionId = subscription.subscriptionId;
    
            const topic = await this.pickUpTopicId(subscriptionId);
    
            if (!topic) {
                return;
            }

            resourceId = topic.id;
            topicName = topic.name;
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const keysUri = `https://management.azure.com${resourceId}/listKeys?api-version=2021-12-01`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });
        const keys = keysResponse.data;

        if (!keys) {
            return;
        }

        const options = Object.keys(keys).map(keyName => {
            return {
                label: keyName,
                value: keys[keyName]
            };
        });

        const selectedOption = await vscode.window.showQuickPick(options, { title: 'Select Azure Event Grid Secret' });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureEventGrid,
            name: `${topicName}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: selectedOption.label,
            }
        };
    }

    private async pickUpTopicId(subscriptionId: string): Promise<{ id: string, name: string } | undefined> {

        const credentials = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.eventgrid/topics"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Event Grid Topics found in this subscription');
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
            { title: 'Select Event Grid Topic' }
        );

        if (!!pickResult) {
            
            return {
                id: pickResult.id,
                name: pickResult.label
            };
        }
    }

    private parseResourceId(resourceId: string): { subscriptionId: string, topicName: string } | undefined {

        const match = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.eventgrid\/topics\/([^\/]+)$/gi.exec(resourceId);
        
        return !match ? undefined : {
            subscriptionId: match[1],
            topicName: match[3]
        };
    }
} 
