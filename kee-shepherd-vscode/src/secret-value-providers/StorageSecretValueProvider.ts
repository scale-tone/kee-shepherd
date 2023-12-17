import * as vscode from 'vscode';

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { StorageManagementClient } from '@azure/arm-storage';

// Implements picking and retrieving secret values from Azure Storage
export class StorageSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: SecretReference): Promise<string> {

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

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {

        let subscriptionId: string | undefined, resourceGroupName: string | undefined, accountName: string | undefined;
        let storageEndpoints = ''; 

        const tokenCredentials = await this._account.getTokenCredential();
        let storageManagementClient: StorageManagementClient;

        if (!!resourceId) {

            const resourceIdMatch = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.storage\/storageaccounts\/(.+)/gi.exec(resourceId);
            if (!resourceIdMatch) {
                return;
            }

            subscriptionId = resourceIdMatch[1];
            resourceGroupName = resourceIdMatch[2];
            accountName = resourceIdMatch[3];

            storageManagementClient = new StorageManagementClient(tokenCredentials, subscriptionId);
            
            const storageAccount = await storageManagementClient.storageAccounts.getProperties(resourceGroupName, accountName);

            if (!!storageAccount.primaryEndpoints) {
                storageEndpoints = `BlobEndpoint=${storageAccount.primaryEndpoints!.blob};QueueEndpoint=${storageAccount.primaryEndpoints!.queue};TableEndpoint=${storageAccount.primaryEndpoints!.table};FileEndpoint=${storageAccount.primaryEndpoints!.file};`;
            } else {
                storageEndpoints = `BlobEndpoint=https://${storageAccount.name}.blob.core.windows.net/;QueueEndpoint=https://${storageAccount.name}.queue.core.windows.net/;TableEndpoint=https://${storageAccount.name}.table.core.windows.net/;FileEndpoint=https://${storageAccount.name}.file.core.windows.net/;`;
            }

        } else {

            const subscription = await this._account.pickUpSubscription();
            if (!subscription) {
                return;
            }
            
            subscriptionId = subscription.subscription.subscriptionId;

            storageManagementClient = new StorageManagementClient(tokenCredentials, subscriptionId);
    
            const storageAccount = await this._account.pickUpStorageAccount(storageManagementClient);
    
            if (!storageAccount) {
                return;
            }

            resourceId = storageAccount.id;
            accountName = storageAccount.name;

            // Extracting resource group name
            const match = /\/resourceGroups\/([^\/]+)\/providers/gi.exec(resourceId!);
            if (!match || match.length <= 0) {
                return;
            }
            resourceGroupName = match[1];            

            if (!!storageAccount.primaryEndpoints) {
                storageEndpoints = `BlobEndpoint=${storageAccount.primaryEndpoints!.blob};QueueEndpoint=${storageAccount.primaryEndpoints!.queue};TableEndpoint=${storageAccount.primaryEndpoints!.table};FileEndpoint=${storageAccount.primaryEndpoints!.file};`;
            } else {
                storageEndpoints = `BlobEndpoint=https://${storageAccount.name}.blob.core.windows.net/;QueueEndpoint=https://${storageAccount.name}.queue.core.windows.net/;TableEndpoint=https://${storageAccount.name}.table.core.windows.net/;FileEndpoint=https://${storageAccount.name}.file.core.windows.net/;`;
            }
        }

        const storageConnString = `DefaultEndpointsProtocol=https;${storageEndpoints}AccountName=${accountName};`;

        const storageKeys = await storageManagementClient.storageAccounts.listKeys(resourceGroupName, accountName!);

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
            name: `${accountName}-${selectedOption.label}`,
            value: selectedOption.value,
            properties: {
                subscriptionId: subscriptionId,
                resourceGroupName,
                storageAccountName: accountName,
                storageAccountKeyName: selectedOption.keyName,
                storageConnectionString: selectedOption.connString
            }
        };
    }
}
