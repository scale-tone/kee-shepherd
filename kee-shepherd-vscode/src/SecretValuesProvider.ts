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
import { CodespaceSecretValueProvider, CodespaceSecretKind, CodespaceSecretVisibility } from './secret-value-providers/CodespaceSecretValueProvider';
import { Log } from './helpers';
import { VsCodeSecretStorageValueProvider } from './secret-value-providers/VsCodeSecretStorageValueProvider';
import { CodespacesTreeView } from './tree-views/CodespacesTreeView';

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    private _providers: { [secretType: number]: ISecretValueProvider } = {};

    constructor(private _context: vscode.ExtensionContext, private _account: AzureAccountWrapper, private _log: Log) {
        
        this._providers[SecretTypeEnum.AzureKeyVault] = new KeyVaultSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureStorage] = new StorageSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureServiceBus] = new ServiceBusSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureEventHubs] = new EventHubSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureCosmosDb] = new CosmosDbSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureRedisCache] = new AzureRedisSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureAppInsights] = new AppInsightsSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureEventGrid] = new EventGridSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureMaps] = new AzureMapsSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureCognitiveServices] = new AzureCognitiveServicesSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureSearch] = new AzureSearchSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureSignalR] = new AzureSignalRSecretValueProvider(_account);
        this._providers[SecretTypeEnum.ResourceManagerRestApi] = new ResourceManagerRestApiSecretValueProvider(_account);
        this._providers[SecretTypeEnum.AzureDevOpsPAT] = new AzureDevOpsSecretValueProvider(_account, (secretName: string) => this.askUserWhereToStoreSecret(secretName));
        this._providers[SecretTypeEnum.Codespaces] = new CodespaceSecretValueProvider(_account, this._log);
        this._providers[SecretTypeEnum.VsCodeSecretStorage] = new VsCodeSecretStorageValueProvider(_context, _account);
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

    async askUserWhereToStoreSecret(secretName: string): Promise<SecretStorageUserChoice | undefined> {

        const storageChoice = await vscode.window.showQuickPick([

            {
                label: 'VsCode SecretStorage (aka locally on this machine)',
                whereToStore: SecretTypeEnum.VsCodeSecretStorage
            },
            {
                label: 'Azure Key Vault',
                whereToStore: SecretTypeEnum.AzureKeyVault
            },
            {
                label: 'GitHub Codespaces Personal Secret',
                whereToStore: 'Personal' as CodespaceSecretKind
            },
            {
                label: 'GitHub Codespaces Organization Secret',
                whereToStore: 'Organization' as CodespaceSecretKind
            },
            {
                label: 'GitHub Codespaces Repository Secret',
                whereToStore: 'Repository' as CodespaceSecretKind
            },

        ], { title: `Where to store this secret's value` });

        switch (storageChoice?.whereToStore)
        {
            case SecretTypeEnum.VsCodeSecretStorage:

                if (!!(await this._context.secrets.get(secretName))) {

                    const userResponse = await vscode.window.showWarningMessage(
                        `A secret named ${secretName} already exists in VsCode SecretStorage. Do you want to overwrite it?`,
                        'Yes', 'No');
           
                    if (userResponse !== 'Yes') {
                        return;
                    }
                }
                
                return {

                    secretType: SecretTypeEnum.VsCodeSecretStorage,

                    persistRoutine: async (secretValue: string) => {

                        await this._context.secrets.store(secretName, secretValue);
                    }
                };
                                
            case SecretTypeEnum.AzureKeyVault:

                const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
                
                const keyVaultName = await keyVaultProvider.pickUpKeyVault();
        
                if (!keyVaultName) {
                    return;
                }

                const keyVaultClient = await keyVaultProvider.getKeyVaultClient(keyVaultName);

                const checkResult = await KeyVaultSecretValueProvider.checkIfSecretExists(keyVaultClient, secretName);
                if (checkResult === 'not-ok-to-overwrite') {
                    return;
                }
    
                return {

                    secretType: SecretTypeEnum.AzureKeyVault,

                    secretProperties: {
                        keyVaultName: keyVaultName,
                        keyVaultSecretName: secretName
                    },

                    persistRoutine: async (secretValue: string) => {

                        await keyVaultClient.setSecret(secretName, secretValue);        
                    }
                };
            
            case 'Personal': {

                // This should be at the beginning, since it might require the user to re-authenticate
                const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecretsAndRepos();

                const selectedRepoIds = await CodespacesTreeView.pickUpPersonalRepoIds(undefined, accessToken);
                if (!selectedRepoIds?.length) {
                    return;
                }
        
                const selectedRepoIdsAsStrings = selectedRepoIds.map(id => id.toString());
        
                return {

                    secretType: SecretTypeEnum.Codespaces,

                    secretProperties: {
                        name: secretName.toUpperCase(),
                        kind: 'Personal' as CodespaceSecretKind,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        visibility: 'selected',
                        selectedRepositoriesUri: `https://api.github.com/user/codespaces/secrets/${secretName}/repositories`
                    },

                    persistRoutine: async (secretValue: string) => {

                        await CodespaceSecretValueProvider.setSecretValue('user', accessToken, secretName, secretValue, undefined, selectedRepoIdsAsStrings);
                    }
                };
            }
            
            case 'Organization': {

                // This should be at the beginning, since it might require the user to re-authenticate
                const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgAndRepoSecrets();
                
                const orgs = await CodespaceSecretValueProvider.getUserOrgs(accessToken);

                const orgName = await vscode.window.showQuickPick(orgs, { title: `Select GitHub Organization` });

                if (!orgName) {
                    return;
                }
    
                const selectedVisibilityOption = await vscode.window.showQuickPick([

                    {
                        label: `All Repositories in ${orgName} organization`,
                        visibility: 'all' as CodespaceSecretVisibility
                    },
                    {
                        label: `All Private Repositories in ${orgName} organization`,
                        visibility: 'private' as CodespaceSecretVisibility
                    },
                    {
                        label: `Selected Repositories in ${orgName} organization`,
                        visibility: 'selected' as CodespaceSecretVisibility
                    },
        
                ], { title: `Select visibility level for your secret (which repositories should have access to it)` });
        
                if (!selectedVisibilityOption) {
                    return;
                }
        
                let selectedRepoIds: number[] | undefined = undefined;
        
                if (selectedVisibilityOption.visibility === 'selected') {
        
                    selectedRepoIds = await CodespacesTreeView.pickUpOrgRepoIds(orgName, undefined, accessToken, this._log);
                    if (!selectedRepoIds?.length) {
                        return;
                    }
                }
        
                return {

                    secretType: SecretTypeEnum.Codespaces,

                    secretProperties: {
                        name: secretName.toUpperCase(),
                        kind: 'Organization' as CodespaceSecretKind,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        visibility: selectedVisibilityOption.visibility,
                        selectedRepositoriesUri: `https://api.github.com/orgs/${orgName}/codespaces/secrets/${secretName}/repositories`
                    },

                    persistRoutine: async (secretValue: string) => {

                        await CodespaceSecretValueProvider.setSecretValue(`orgs/${orgName}`, accessToken, secretName, secretValue, selectedVisibilityOption.visibility, selectedRepoIds);
                    }
                };
            }
            
            case 'Repository': {
            
                // This should be at the beginning, since it might require the user to re-authenticate
                const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();

                const repos = await CodespaceSecretValueProvider.getUserRepos(accessToken);

                const repoName = await vscode.window.showQuickPick(repos.map(repo => repo.fullName), { title: `Select repository` });
        
                if (!repoName) {
                    return;
                }

                return {

                    secretType: SecretTypeEnum.Codespaces,

                    secretProperties: {
                        name: secretName.toUpperCase(),
                        kind: 'Repository' as CodespaceSecretKind,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    },

                    persistRoutine: async (secretValue: string) => {

                        await CodespaceSecretValueProvider.setSecretValue(`repos/${repoName}`, accessToken, secretName, secretValue);
                    }
                };
            }
        }
    }
}

export type SecretStorageUserChoice = {

    secretType: SecretTypeEnum,
    secretProperties?: {},
    persistRoutine: (secretValue: string) => Promise<void>
};