import * as vscode from 'vscode';

import { AzureAccountWrapper } from "./AzureAccountWrapper";
import { AnchorPrefix, ControlledSecret, SecretTypeEnum, ControlTypeEnum } from "./KeyMetadataHelpers";
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
import { AzureMapsSecretValueProvider } from './secret-value-providers/AzureMapsSecretValueProvider';
import { AzureCognitiveServicesSecretValueProvider } from './secret-value-providers/AzureCognitiveServicesSecretValueProvider';
import { AzureSearchSecretValueProvider } from './secret-value-providers/AzureSearchSecretValueProvider';
import { AzureSignalRSecretValueProvider } from './secret-value-providers/AzureSignalRSecretValueProvider';
import { AzureDevOpsSecretValueProvider } from './secret-value-providers/AzureDevOpsSecretValueProvider';
import { CodespaceSecretValueProvider } from './secret-value-providers/CodespaceSecretValueProvider';
import { Log } from './helpers';
import { VsCodeSecretStorageValueProvider } from './secret-value-providers/VsCodeSecretStorageValueProvider';

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    private _providers: { [secretType: number]: ISecretValueProvider } = {};

    constructor(context: vscode.ExtensionContext, account: AzureAccountWrapper, log: Log) {
        
        this._providers[SecretTypeEnum.AzureKeyVault] = new KeyVaultSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureStorage] = new StorageSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureServiceBus] = new ServiceBusSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureEventHubs] = new EventHubSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureCosmosDb] = new CosmosDbSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureRedisCache] = new AzureRedisSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureAppInsights] = new AppInsightsSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureEventGrid] = new EventGridSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureMaps] = new AzureMapsSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureCognitiveServices] = new AzureCognitiveServicesSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureSearch] = new AzureSearchSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureSignalR] = new AzureSignalRSecretValueProvider(account);
        this._providers[SecretTypeEnum.ResourceManagerRestApi] = new ResourceManagerRestApiSecretValueProvider(account);
        this._providers[SecretTypeEnum.AzureDevOpsPAT] = new AzureDevOpsSecretValueProvider(account);
        this._providers[SecretTypeEnum.Codespaces] = new CodespaceSecretValueProvider(account, log);
        this._providers[SecretTypeEnum.VsCodeSecretStorage] = new VsCodeSecretStorageValueProvider(context, account);
    }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const provider = this._providers[secret.type];
        return !provider ? '' : provider.getSecretValue(secret);
    }

    async pickUpSecret(controlType: ControlTypeEnum, excludedSecretTypes?: SecretTypeEnum[], selectedSecretType?: SecretTypeEnum): Promise<SelectedSecretType | undefined> {

        if (!selectedSecretType) {

            let secretTypes = [
                { label: 'Azure Key Vault', type: SecretTypeEnum.AzureKeyVault },
                { label: 'Azure Storage', type: SecretTypeEnum.AzureStorage },
                { label: 'Azure Service Bus', type: SecretTypeEnum.AzureServiceBus },
                { label: 'Azure Event Hubs', type: SecretTypeEnum.AzureEventHubs },
                { label: 'Azure Event Grid', type: SecretTypeEnum.AzureEventGrid },
                { label: 'Azure Cosmos DB', type: SecretTypeEnum.AzureCosmosDb },
                { label: 'Azure Redis Cache', type: SecretTypeEnum.AzureRedisCache },
                { label: 'Azure Application Insights', type: SecretTypeEnum.AzureAppInsights },
                { label: 'Azure Maps', type: SecretTypeEnum.AzureMaps },
                { label: 'Azure Cognitive Services', type: SecretTypeEnum.AzureCognitiveServices },
                { label: 'Azure Search', type: SecretTypeEnum.AzureSearch },
                { label: 'Azure SignalR Services', type: SecretTypeEnum.AzureSignalR },
                { label: 'Azure DevOps Personal Access Tokens', type: SecretTypeEnum.AzureDevOpsPAT },
                { label: 'Custom (Azure Resource Manager REST API)', type: SecretTypeEnum.ResourceManagerRestApi },
                { label: 'GitHub Codespaces Secret', type: SecretTypeEnum.Codespaces },
            ];
    
            if (!!excludedSecretTypes) {
                
                secretTypes = secretTypes.filter(t => !excludedSecretTypes.includes(t.type));
            }
    
            const userChoice = await vscode.window.showQuickPick(
                secretTypes, 
                { title: 'Select where to take the secret from' }
            );
            
            if (!userChoice){
                return;
            }

            selectedSecretType = userChoice.type;
        }
        
        const provider = this._providers[selectedSecretType];
        if (!provider) {
            return undefined;
        }

        const secret = await provider.pickUpSecret(controlType);

        if (!!secret && secret.value.startsWith(AnchorPrefix)) {
            throw new Error(`Secret value should not start with ${AnchorPrefix}`);
        }            

        return secret;
    }
}