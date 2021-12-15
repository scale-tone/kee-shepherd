import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';

// Implements picking and retrieving secret values from Azure Application Insights
export class AppInsightsSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
        const token = await tokenCredentials.getToken();

        const response = await axios.get(secret.properties.resourceManagerUri, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

        if (!response.data?.properties) {
            return '';
        }

        return response.data?.properties[secret.properties.keyName];
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

        const instanceUri = `https://management.azure.com${instanceId}?api-version=2015-05-01`;
        const instanceResponse = await axios.get(instanceUri, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });

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
        }
    }

    private async pickUpInstanceId(subscriptionId: string, credentials: DeviceTokenCredentials): Promise<string> {

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
} 
