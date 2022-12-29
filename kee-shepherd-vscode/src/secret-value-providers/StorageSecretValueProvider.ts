import * as vscode from 'vscode';

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { StorageManagementClient } from '@azure/arm-storage';

// Implements picking and retrieving secret values from Azure Storage
export class StorageSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const tokenCredentials = await this._account.getTokenCredential();
        const storageManagementClient = new StorageManagementClient(tokenCredentials, secret.properties.subscriptionId);

        const storageKeys = await storageManagementClient.storageAccounts.listKeys(secret.properties.resourceGroupName, secret.properties.storageAccountName);
        if (!storageKeys.keys) {
            return '';
        }

        const storageKey = (storageKeys.keys!.find(k => k.keyName === secret.properties.storageAccountKeyName))?.value ?? '';
      
        if (!!secret.properties.storageConnectionString) {
            return `${secret.properties.storageConnectionString}AccountKey=${storageKey};`;
        }

        return storageKey;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const tokenCredentials = await this._account.getTokenCredential();

        const storageManagementClient = new StorageManagementClient(tokenCredentials, subscriptionId);

        const storageAccount = await this._account.picUpStorageAccount(storageManagementClient);

        if (!storageAccount) {
            return;
        }

        var storageEndpoints = ''; 
        if (!!storageAccount.primaryEndpoints) {
            storageEndpoints = `BlobEndpoint=${storageAccount.primaryEndpoints!.blob};QueueEndpoint=${storageAccount.primaryEndpoints!.queue};TableEndpoint=${storageAccount.primaryEndpoints!.table};FileEndpoint=${storageAccount.primaryEndpoints!.file};`;
        } else {
            storageEndpoints = `BlobEndpoint=https://${storageAccount.name}.blob.core.windows.net/;QueueEndpoint=https://${storageAccount.name}.queue.core.windows.net/;TableEndpoint=https://${storageAccount.name}.table.core.windows.net/;FileEndpoint=https://${storageAccount.name}.file.core.windows.net/;`;
        }

        const storageConnString = `DefaultEndpointsProtocol=https;${storageEndpoints}AccountName=${storageAccount.name};`;

        // Extracting resource group name
        const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(storageAccount.id!);
        if (!match || match.length <= 0) {
            return;
        }
        const resourceGroupName = match[1];

        const storageKeys = await storageManagementClient.storageAccounts.listKeys(resourceGroupName, storageAccount.name!);

        const options = storageKeys.keys!.map(key => {
            return [
                {
                    label: key.keyName!,
                    detail: !!key.creationTime ? `created ${key.creationTime?.toISOString().slice(0, 10)}` : '',
                    keyName: key.keyName!,
                    value: key.value!
                },
                {
                    label: `Connection String with ${key.keyName}`,
                    detail: !!key.creationTime ? `created ${key.creationTime?.toISOString().slice(0, 10)}` : '',
                    keyName: key.keyName!,
                    value: `${storageConnString}AccountKey=${key.value};`,
                    connString: storageConnString
                }
            ];
        });

        const selectedOption = await vscode.window.showQuickPick(options.flat(), { title: 'Select Storage Account Secret' });
        if (!selectedOption) {
            return;
        }

        return {
            type: SecretTypeEnum.AzureStorage,
            name: `${storageAccount.name}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId: subscriptionId,
                resourceGroupName,
                storageAccountName: storageAccount.name,
                storageAccountKeyName: selectedOption.keyName,
                storageConnectionString: selectedOption.connString
            }
        }
    }
}
