import * as vscode from 'vscode';
import axios from "axios";

import { StorageManagementClient } from "@azure/arm-storage";
import { SecretClient } from "@azure/keyvault-secrets";
import { AzureAccountWrapper, AzureSubscription } from "./AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "./KeyMetadataHelpers";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

export type SelectedSecretType = { type: SecretTypeEnum, name: string, value: string, properties: any };

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        switch (secret.type) {
            case SecretTypeEnum.AzureKeyVault: {

                // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId, 'https://vault.azure.net');
                
                const keyVaultClient = new SecretClient(`https://${secret.properties.keyVaultName}.vault.azure.net`, tokenCredentials as any);
                const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);
                return keyVaultSecret.value ?? '';
            }   
            case SecretTypeEnum.AzureStorage: {

                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
                const storageManagementClient = new StorageManagementClient(tokenCredentials, secret.properties.subscriptionId);

                const storageKeys = await storageManagementClient.storageAccounts.listKeys(secret.properties.resourceGroupName, secret.properties.storageAccountName);
                if (!storageKeys.keys) {
                    return '';
                }

                const storageKey = storageKeys.keys!.find(k => k.keyName === secret.properties.storageAccountKeyName);
                return storageKey?.value ?? '';
            }
            case SecretTypeEnum.Custom: {

                const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId);
                const token = await tokenCredentials.getToken();

                const response = await axios.post(secret.properties.resourceManagerUri, undefined, { headers: { 'Authorization': `Bearer ${token.accessToken}` } });
        
                const keys = this.resourceManagerResponseToKeys(response.data);
                if (!keys) {
                    return '';
                }

                return keys.find(k => k.label === secret.properties.keyName)?.value ?? '';
            }
            default:
                return '';
        }
    }

    pickUpKeyVault(subscription: AzureSubscription): Promise<string> {
        return new Promise<string>((resolve, reject) => {

            // Picking up a KeyVault
            var keyVaultName: string;

            const pick = vscode.window.createQuickPick();
            pick.onDidHide(() => {
                pick.dispose();
                resolve('');
            });

            pick.onDidChangeSelection(items => {
                if (!!items && !!items.length) {
                    keyVaultName = items[0].label;
                }
            });

            // Still allowing to type free text
            pick.onDidChangeValue(value => {
                keyVaultName = value;
            });

            pick.onDidAccept(() => {
                resolve(keyVaultName);
                pick.hide();
            });

            pick.title = 'Select or Enter KeyVault Name';

            // Getting the list of existing KeyVaults
            const resourceGraphClient = new ResourceGraphClient(subscription.session.credentials2);

            resourceGraphClient.resources({

                subscriptions: [subscription.subscription.subscriptionId],
                query: 'resources | where type == "microsoft.keyvault/vaults"'
                    
            }).then(response => {

                if (!!response.data && response.data.length >= 0) {

                    pick.items = response.data.map((keyVault: any) => {
                        return { label: keyVault.name };
                    });

                    pick.placeholder = response.data[0].name;
                }
            });

            pick.show();
        });
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const secretType = await vscode.window.showQuickPick(
            [
                { label: 'Azure Key Vault', type: SecretTypeEnum.AzureKeyVault },
                { label: 'Azure Storage', type: SecretTypeEnum.AzureStorage },
                { label: 'Custom (Azure Resource Manager REST API)', type: SecretTypeEnum.Custom },
            ], 
            { title: 'Select where to take the secret from' }
        );

        if (!secretType) {
            return;
        }

        switch (secretType.type) {
            case SecretTypeEnum.AzureKeyVault:
                return await this.pickUpSecretFromKeyVault();
            case SecretTypeEnum.AzureStorage:
                return await this.pickUpSecretFromStorage();
            case SecretTypeEnum.Custom:
                return await this.pickUpCustomSecret();
        }
    }

    private async pickUpCustomSecret(): Promise<SelectedSecretType | undefined> {

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
            type: SecretTypeEnum.Custom,
            name: key.label,
            value: key.value,
            properties: {
                subscriptionId,
                resourceManagerUri: uri,
                keyName: key.label
            }
        };
    }

    private async pickUpSecretFromKeyVault(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const keyVaultName = await this.pickUpKeyVault(subscription);

        if (!keyVaultName) {
            return;
        }
        
        // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId, 'https://vault.azure.net');

        const keyVaultClient = new SecretClient(`https://${keyVaultName}.vault.azure.net`, tokenCredentials as any);

        const secretNames = [];
        for await (const secretProps of keyVaultClient.listPropertiesOfSecrets()) {
            secretNames.push(secretProps.name);
        }

        if (secretNames.length <= 0) {
            throw new Error(`No secrets found in this Key Vault`);
        }

        const secretName = await vscode.window.showQuickPick(secretNames, { title: 'Select Secret' });

        if (!secretName) {
            return;
        }

        const secret = await keyVaultClient.getSecret(secretName);
        if (!secret.value) {
            throw new Error(`Secret ${secretName} is empty`);
        }           

        return {
            type: SecretTypeEnum.AzureKeyVault,
            name: secretName,
            value: secret.value,
            properties: {
                subscriptionId: subscriptionId,
                keyVaultName,
                keyVaultSecretName: secretName
            }
        }
    }

    private async pickUpSecretFromStorage(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const storageManagementClient = new StorageManagementClient(subscription.session.credentials2, subscriptionId);

        const storageAccount = await this._account.picUpStorageAccount(storageManagementClient);

        if (!storageAccount) {
            return;
        }

        // Extracting resource group name
        const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
        if (!match || match.length <= 0) {
            return;
        }
        const resourceGroupName = match[1];

        const storageKeys = await storageManagementClient.storageAccounts.listKeys(resourceGroupName, storageAccount.name!);

        const storageKey = await vscode.window.showQuickPick(storageKeys.keys!.map(key => {
                return {
                    label: key.keyName!,
                    description: !!key.creationTime ? `created ${key.creationTime}` : '',
                    key
                }
            }), 
            { title: 'Select Storage Account Key' }
        );

        if (!storageKey) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureStorage,
            name: `${storageAccount.name}-${storageKey.key.keyName}`,
            value: storageKey.key.value!,
            properties: {
                subscriptionId: subscriptionId,
                resourceGroupName,
                storageAccountName: storageAccount.name,
                storageAccountKeyName: storageKey.key.keyName
            }
        }
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