import * as vscode from 'vscode';
import { SecretClient, SecretProperties } from "@azure/keyvault-secrets";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlTypeEnum, SecretReference, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

// Implements picking and retrieving secret values from Azure Key Vault
export class KeyVaultSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    isMyResourceId(resourceId: string): boolean { return !!this.parseResourceId(resourceId); }

    async getKeyVaultClient(keyVaultName: string): Promise<SecretClient> {

        const tokenCredential = await this._account.getTokenCredential(['https://vault.azure.net/user_impersonation']);
        
        return new SecretClient(`https://${keyVaultName}.vault.azure.net`, tokenCredential);
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

    async getSecretValue(secret: SecretReference): Promise<string> {

        const keyVaultClient = await this.getKeyVaultClient(secret.properties.keyVaultName);

        const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);
        return keyVaultSecret.value ?? '';
    }

    async pickUpSecret(controlType: ControlTypeEnum, resourceId?: string): Promise<SelectedSecretType | undefined> {
        
        let keyVaultName: string | undefined, secretName: string | undefined;

        let keyVaultClient: SecretClient;

        if (!!resourceId) {

            const parseResult = this.parseResourceId(resourceId);

            if (!parseResult) {
                return;
            }

            ({ keyVaultName, secretName } = parseResult);
            
            keyVaultClient = await this.getKeyVaultClient(keyVaultName);

        } else {

            keyVaultName = await this.pickUpKeyVault();

            if (!keyVaultName) {
                return;
            }

            keyVaultClient = await this.getKeyVaultClient(keyVaultName);

            const secretNames = [];
            for await (const secretProps of keyVaultClient.listPropertiesOfSecrets()) {
                secretNames.push(secretProps.name);
            }
    
            if (secretNames.length <= 0) {
                throw new Error(`No secrets found in this Key Vault`);
            }
    
            secretName = await vscode.window.showQuickPick(secretNames, { title: 'Select Secret' });
    
            if (!secretName) {
                return;
            }
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
                keyVaultName,
                keyVaultSecretName: secretName
            }
        };
    }

    async getSecrets(keyVaultName: string): Promise<SecretProperties[]> {

        const keyVaultClient = await this.getKeyVaultClient(keyVaultName);
        
        const result = [];
        for await (const secretProps of keyVaultClient.listPropertiesOfSecrets()) {
            result.push(secretProps);
        }

        return result;
    }

    async getSecretVersions(keyVaultName: string, secretName: string): Promise<SecretProperties[]> {

        const keyVaultClient = await this.getKeyVaultClient(keyVaultName);
        
        const result = [];
        for await (const secretProps of keyVaultClient.listPropertiesOfSecretVersions(secretName)) {
            result.push(secretProps);
        }

        return result;
    }

    async pickUpKeyVault(): Promise<string> {

        const credential = await this._account.getTokenCredential();
        const resourceGraphClient = new ResourceGraphClient(credential);

        const subscriptions = await this._account.getSubscriptions();

        return await new Promise<string>((resolve, reject) => {
    
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
    
            resourceGraphClient.resources({
    
                subscriptions: subscriptions.map(s => s.subscriptionId),
                query: 'resources | where type == "microsoft.keyvault/vaults"'
                    
            }).then(response => {
    
                if (!!response.data && response.data.length >= 0) {
    
                    pick.items = response.data.map((keyVault: any) => {

                        const subscription = subscriptions.find(s => s.subscriptionId === keyVault.subscriptionId);

                        return {
                            label: keyVault.name,
                            detail: `${subscription?.name} ${keyVault.subscriptionId}`
                        };
                    });
    
                    pick.placeholder = response.data[0].name;
                }
            });
    
            pick.show();
        });
    }

    private parseResourceId(resourceId: string): { keyVaultName: string, secretName: string } | undefined {

        const match = /\/subscriptions\/([^\/]+)\/resourceGroups\/([^\/]+)\/providers\/microsoft.keyvault\/vaults\/([^\/]+)\/(keys|secrets)\/([^\/]+)$/gi.exec(resourceId);
        
        return !match ? undefined : {
            keyVaultName: match[3],
            secretName: match[5]
        };
    }
} 
