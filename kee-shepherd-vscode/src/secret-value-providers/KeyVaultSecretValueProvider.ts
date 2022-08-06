import * as vscode from 'vscode';
import { SecretClient, SecretProperties } from "@azure/keyvault-secrets";

import { AzureAccountWrapper, AzureSubscription } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Key Vault
export class KeyVaultSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getKeyVaultClient(subscriptionId: string, keyVaultName: string): Promise<SecretClient> {

        // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
        const tokenCredentials = await this._account.getTokenCredentials(subscriptionId, 'https://vault.azure.net');
        
        return new SecretClient(`https://${keyVaultName}.vault.azure.net`, tokenCredentials as any);
    }

    static async checkIfSecretExists(keyVaultClient: SecretClient, secretName: string): Promise<'does-not-exist' | 'ok-to-overwrite' | 'not-ok-to-overwrite'> {

        try {

            await keyVaultClient.getSecret(secretName);

            const userResponse = await vscode.window.showWarningMessage(
                `A secret named ${secretName} already exists in this Key Vault. This operation will add a new version of that secret. Do you want to proceed?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return 'not-ok-to-overwrite';
            }

            return 'ok-to-overwrite';
            
        } catch (err) {
            
            console.log(err);
            return 'does-not-exist';
        }
    }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const keyVaultClient = await this.getKeyVaultClient(secret.properties.subscriptionId, secret.properties.keyVaultName);

        const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);
        return keyVaultSecret.value ?? '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const keyVaultName = await KeyVaultSecretValueProvider.pickUpKeyVault(subscription);

        if (!keyVaultName) {
            return;
        }
        
        const keyVaultClient = await this.getKeyVaultClient(subscriptionId, keyVaultName);
        
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
        };
    }

    async getSecretProps(subscriptionId: string, keyVaultName: string): Promise<SecretProperties[]> {

        const keyVaultClient = await this.getKeyVaultClient(subscriptionId, keyVaultName);
        
        const result = [];
        for await (const secretProps of keyVaultClient.listPropertiesOfSecrets()) {
            result.push(secretProps);
        }

        return result;
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
    
            pick.title = 'Select or Enter Key Vault Name';
    
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
