import * as vscode from 'vscode';

import { AzureAccountWrapper } from "./AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "./KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from './secret-value-providers/ISecretValueProvider';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { StorageSecretValueProvider } from './secret-value-providers/StorageSecretValueProvider';
import { ResourceManagerRestApiSecretValueProvider } from './secret-value-providers/ResourceManagerRestApiSecretValueProvider';
import { ServiceBusSecretValueProvider } from './secret-value-providers/ServiceBusSecretValueProvider';

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    private _providers: { [secretType: number]: ISecretValueProvider } = {};

    constructor(protected _account: AzureAccountWrapper) {
        
        this._providers[SecretTypeEnum.AzureKeyVault] = new KeyVaultSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureStorage] = new StorageSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureServiceBus] = new ServiceBusSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.ResourceManagerRestApi] = new ResourceManagerRestApiSecretValueProvider(this._account);
    }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const provider = this._providers[secret.type];
        return !provider ? '' : provider.getSecretValue(secret);
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const secretType = await vscode.window.showQuickPick(
            [
                { label: 'Azure Key Vault', type: SecretTypeEnum.AzureKeyVault },
                { label: 'Azure Storage', type: SecretTypeEnum.AzureStorage },
                { label: 'Azure Service Bus', type: SecretTypeEnum.AzureServiceBus },
                { label: 'Custom (Azure Resource Manager REST API)', type: SecretTypeEnum.ResourceManagerRestApi },
            ], 
            { title: 'Select where to take the secret from' }
        );

        if (!secretType) {
            return;
        }

        const provider = this._providers[secretType.type];
        return provider?.pickUpSecret();
    }
}