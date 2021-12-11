import * as vscode from 'vscode';
import { SecretClient } from "@azure/keyvault-secrets";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { SecretValuesProvider } from "../SecretValuesProvider";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";

// Implements picking and retrieving secret values from Azure Key Vault
export class KeyVaultSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        // Need to create our own credentials object, because the one that comes from Azure Account ext has a wrong resourceId in it
        const tokenCredentials = await this._account.getTokenCredentials(secret.properties.subscriptionId, 'https://vault.azure.net');
        
        const keyVaultClient = new SecretClient(`https://${secret.properties.keyVaultName}.vault.azure.net`, tokenCredentials as any);
        const keyVaultSecret = await keyVaultClient.getSecret(secret.properties.keyVaultSecretName);
        return keyVaultSecret.value ?? '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }
        
        const subscriptionId = subscription.subscription.subscriptionId;
        const keyVaultName = await SecretValuesProvider.pickUpKeyVault(subscription);

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
} 
