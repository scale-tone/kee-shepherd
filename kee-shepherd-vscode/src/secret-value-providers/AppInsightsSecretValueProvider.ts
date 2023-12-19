import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Application Insights
export class AppInsightsSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    isMyResourceId(resourceId: string): boolean { return !!this.parseResourceId(resourceId); }

    async getSecretValue(secret: SecretReference): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.get(secret.properties.resourceManagerUri, { headers: { 'Authorization': `Bearer ${token}` } });

        if (!response.data?.properties) {
            return '';
        }

        return response.data?.properties[secret.properties.keyName];
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
    
            subscriptionId = subscription.subscription.subscriptionId;
    
            resourceId = await this.pickUpInstanceId(subscriptionId);
    
            if (!resourceId) {
                return;
            }    
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const instanceUri = `https://management.azure.com${resourceId}?api-version=2015-05-01`;
        const instanceResponse = await axios.get(instanceUri, { headers: { 'Authorization': `Bearer ${token}` } });

        const instanceName = instanceResponse.data?.name;

        const keys = [
            {
                label: 'InstrumentationKey',
                value: instanceResponse.data?.properties?.InstrumentationKey
            },
            {
                label: 'ConnectionString',
                value: instanceResponse.data?.properties?.ConnectionString
            }
        ];

        const selectedKey = await vscode.window.showQuickPick(keys, { title: 'Select Application Insights Secret' });
        if (!selectedKey) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureAppInsights,
            name: `${instanceName}-${selectedKey.label}`,
            value: selectedKey.value,
            properties: {
                subscriptionId,
                resourceManagerUri: instanceUri,
                keyName: selectedKey.label,
            }
        };
    }

    private async pickUpInstanceId(subscriptionId: string): Promise<string> {

        const credentials = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.insights/components"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Application Insights instances found in this subscription');
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
            { title: 'Select Application Insights instance' }
        );

        return !!pickResult ? pickResult.id : '';
    }

    private parseResourceId(resourceId: string): { subscriptionId: string } | undefined {

        const match = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.insights\/components\/([^\/]+)$/gi.exec(resourceId);
        
        return !match ? undefined : {
            subscriptionId: match[1]
        };
    }
} 
