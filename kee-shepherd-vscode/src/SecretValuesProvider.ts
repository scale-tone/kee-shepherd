import * as vscode from 'vscode';

import { AzureAccountWrapper, AzureSubscription } from "./AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "./KeyMetadataHelpers";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { ISecretValueProvider, SelectedSecretType } from './secret-value-providers/ISecretValueProvider';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { StorageSecretValueProvider } from './secret-value-providers/StorageSecretValueProvider';
import { CustomSecretValueProvider } from './secret-value-providers/CustomSecretValueProvider';

// Handles fetching secret values from all supported sources
export class SecretValuesProvider {

    private _providers: { [secretType: number]: ISecretValueProvider } = {};

    constructor(protected _account: AzureAccountWrapper) {
        
        this._providers[SecretTypeEnum.AzureKeyVault] = new KeyVaultSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.AzureStorage] = new StorageSecretValueProvider(this._account);
        this._providers[SecretTypeEnum.Custom] = new CustomSecretValueProvider(this._account);
    }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const provider = this._providers[secret.type];
        if (!provider) {
            return '';
        }

        return provider.getSecretValue(secret);
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

        const provider = this._providers[secretType.type];
        if (!provider) {
            return;
        }

        return provider.pickUpSecret();
    }

    static pickUpKeyVault(subscription: AzureSubscription): Promise<string> {
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
}