import * as vscode from 'vscode';

import { AzureAccountWrapper } from "./AzureAccountWrapper";
import { AnchorPrefix, ControlledSecret, SecretTypeEnum } from "./KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from './secret-value-providers/ISecretValueProvider';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { StorageSecretValueProvider } from './secret-value-providers/StorageSecretValueProvider';
import { ResourceManagerRestApiSecretValueProvider } from './secret-value-providers/ResourceManagerRestApiSecretValueProvider';
import { ServiceBusSecretValueProvider } from './secret-value-providers/ServiceBusSecretValueProvider';
import { EventHubSecretValueProvider } from './secret-value-providers/EventHubSecretValueProvider';
import { CosmosDbSecretValueProvider } from './secret-value-providers/CosmosDbSecretValueProvider';
import { AzureRedisSecretValueProvider } from './secret-value-providers/AzureRedisSecretValueProvider';
import { AppInsightsSecretValueProvider } from './secret-value-providers/AppInsightsSecretValueProvider';
import { EventGridSecretValueProvider } from './secret-value-providers/EventGridSecretValueProvider';

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    private _providers: { [secretType: number]: ISecretValueProvider } = {};

    constructor(protected _account: AzureAccountWrapper) {
        
        this._providers[SecretTypeEnum.AzureKeyVault] = new KeyVaultSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureStorage] = new StorageSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureServiceBus] = new ServiceBusSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureEventHubs] = new EventHubSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureCosmosDb] = new CosmosDbSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureRedisCache] = new AzureRedisSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureAppInsights] = new AppInsightsSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureEventGrid] = new EventGridSecretValueProvider(this._account);
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
                { label: 'Azure Event Hubs', type: SecretTypeEnum.AzureEventHubs },
                { label: 'Azure Event Grid', type: SecretTypeEnum.AzureEventGrid },
                { label: 'Azure Cosmos DB', type: SecretTypeEnum.AzureCosmosDb },
                { label: 'Azure Redis Cache', type: SecretTypeEnum.AzureRedisCache },
                { label: 'Azure Application Insights', type: SecretTypeEnum.AzureAppInsights },
                { label: 'Custom (Azure Resource Manager REST API)', type: SecretTypeEnum.ResourceManagerRestApi },
            ], 
            { title: 'Select where to take the secret from' }
        );

        if (!secretType) {
            return;
        }

        const provider = this._providers[secretType.type];
        if (!provider) {
            return undefined;
        }

        const secret = await provider.pickUpSecret();

        if (!!secret && secret.value.startsWith(AnchorPrefix)) {
            throw new Error(`Secret value should not start with ${AnchorPrefix}`);
        }            

        return secret;
    }
}