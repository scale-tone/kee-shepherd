import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";

// Implements picking and retrieving secret values from Resource Manager REST API
export class ResourceManagerRestApiSecretValueProvider implements ISecretValueProvider {

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

        var uri = await vscode.window.showInputBox({
            prompt: 'Enter Azure Resource Manager REST API URL',
            placeHolder: `e.g. '/subscriptions/my-subscription-id/resourceGroups/my-group-name/providers/Microsoft.Storage/storageAccounts/my-account/listKeys?api-version=2021-04-01'`
        });
        
        if (!uri) {
            return;
        }

        if (!uri.toLowerCase().startsWith('https://management.azure.com')) {

            if (!uri.startsWith('/')) {
                uri = '/' + uri;
            }
            
            uri = 'https://management.azure.com' + uri;
        }

        if (!uri.includes('api-version=')) {
            uri += '?api-version=2021-04-01';
        }

        // Extracting subscriptionId
        const match = /\/subscriptions\/([^\/]+)\/resourceGroups/gi.exec(uri);
        if (!match || match.length <= 0) {
            return;
        }
        const subscriptionId = match[1];

        // Obtaining default token
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId);
        const token = await tokenCredentials.getToken();

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
            type: SecretTypeEnum.ResourceManagerRestApi,
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
        
        var keys;

        if (!data) {
        
            return;
        
        } else if (!!data.keys && Array.isArray(data.keys)) {
        
            keys = data.keys.map((k: any) => { return { label: k.keyName, value: k.value }; });

        } else {

            keys = Object.keys(data).filter(n => n !== 'keyName').map(n => { return { label: n, value: data[n] }; });
        }

        return keys;
    }
} 
