import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';

// Implements picking and retrieving secret values from Azure Maps
export class AzureMapsSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const token = await this._account.getToken();

        const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });

        const key = response.data[secret.properties.keyName];
        return key;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;

        const mapsAccount = await this.pickUpAccount(subscriptionId);

        if (!mapsAccount) {
            return;
        }

        // Obtaining default token
        const token = await this._account.getToken();

        const keysUri = `https://management.azure.com${mapsAccount.id}/listKeys?api-version=2020-02-01-preview`;
        const keysResponse = await axios.post(keysUri, undefined, { headers: { 'Authorization': `Bearer ${token}` } });
        const keys = keysResponse.data;

        if (!keys) {
            return;
        }

        const options = Object.keys(keys)
            .filter(keyName => keyName !== 'id')
            .map(keyName => {
                return {
                    label: keyName,
                    value: keys[keyName]
                };
        });

        const selectedOption = await vscode.window.showQuickPick(options, { title: 'Select Azure Maps Account Secret' });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureMaps,
            name: `${mapsAccount.name}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId,
                resourceManagerUri: keysUri,
                keyName: selectedOption.label,
            }
        };
    }

    private async pickUpAccount(subscriptionId: string): Promise<{ id: string, name: string } | undefined> {

        const credentials = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credentials);
    
        const response = await resourceGraphClient.resources({

            subscriptions: [subscriptionId],
            query: 'resources | where type == "microsoft.maps/accounts"'
                
        });

        if (!response.data || response.data.length <= 0) {
            throw new Error('No Azure Maps Accounts found in this subscription');
        }

        const instances: { id: string, name: string, resourceGroup: string }[] = response.data;

        const pickResult = await vscode.window.showQuickPick(
            instances.map(n => {
                return {
                    label: n.name,
                    description: `resource group: ${n.resourceGroup}`,
                    id: n.id
                };
            }),
            { title: 'Select Azure Maps Account' }
        );

        if (!!pickResult) {
            
            return {
                id: pickResult.id,
                name: pickResult.label
            };
        }
    }    
} 
