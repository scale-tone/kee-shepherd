import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum, AnchorPrefix, ControlTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { azureDevOpsScopeOptions } from './AzureDevOpsScopeOptions';
import { KeyVaultSecretValueProvider } from './KeyVaultSecretValueProvider';

// Implements picking and retrieving secret values from Azure DevOps
export class AzureDevOpsSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { 
    }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        throw new Error(`Cannot get the value of ${secret.name}. No way to retrieve an Azure DevOps PAT once it was created.`);
    }

    async pickUpSecret(controlType: ControlTypeEnum): Promise<SelectedSecretType | undefined> {

        const subscription = await this._account.pickUpSubscription();
        if (!subscription) {
            return;
        }

        const subscriptionId = subscription.subscription.subscriptionId;

        const accessToken = await this._account.getAzDoTokenViaMsal(subscriptionId);

        const azDoBaseUri = 'https://app.vssps.visualstudio.com/_apis/';

        const profileResponse = await axios.get(`${azDoBaseUri}profile/profiles/me?api-version=7.0`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } });
        const publicAlias = profileResponse.data.publicAlias;

        const accountsResponse = await axios.get(`${azDoBaseUri}accounts?api-version=7.0&memberId=${publicAlias}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } });

        const accounts = accountsResponse?.data?.value as { accountId: string, accountName: string }[];
        if (!accounts || accounts.length <= 0) {
            return;
        }

        const selectedAccount = await vscode.window.showQuickPick(accounts.map(acc => {
                return {
                    label: acc.accountName,
                    description: `(${acc.accountId})`
                };
            }),
            {
                matchOnDescription: true,
                matchOnDetail: true,
                title: 'Select your Azure DevOps organization'
            }
        );

        const azDoOrg = selectedAccount?.label;
        if (!azDoOrg) {
            return;
        }

        const manualEditOption = {
            label: '[Enter/modify the list of scopes manually]',
            detail: '(A separate input box will be shown)',
            description: '',
            alwaysShow: true
        };

        const fullScopedOption = {
            label: 'Full access',
            detail: 'A full-scoped token (might be forbidden in your org)',
            description: '',
            alwaysShow: true
        };

        const selectedScopeOptions = await vscode.window.showQuickPick(
            [
                manualEditOption,
                fullScopedOption,
                ...azureDevOpsScopeOptions
            ],
            {
                canPickMany: true,
                matchOnDescription: true,
                matchOnDetail: true,
                title: 'Pick up or enter the list of scopes'
            });

        if (!selectedScopeOptions || !selectedScopeOptions.length) {
            return;
        }

        const selectedScopes = selectedScopeOptions
            .filter(o => o !== manualEditOption)
            .map(o => o.description);
        
        let scopes;
    
        if (selectedScopeOptions.includes(fullScopedOption)) { 

            scopes = 'app_token';

        } else if (selectedScopeOptions.includes(manualEditOption)) {

            scopes = await vscode.window.showInputBox({
                title: 'Enter/modify a space-separated list of scopes',
                value: selectedScopes.length ? selectedScopes.join(' ') : ''
            });
            
        } else {

            scopes = selectedScopes.join(' ');
        }

        if (!scopes) {
            return;
        }

        const expiresInResponse = await vscode.window.showInputBox({
            value: `30`,
            prompt: 'The new PAT should expire in (days)',
            validateInput: (str: string) => {

                const n = parseInt(str);

                if (isNaN(n) || n < 1) {
                    return 'Provide an integer bigger than 0';
                }

                return null;
            }
        });

        if (!expiresInResponse) {
            return;
        }

        const validTo = new Date();
        validTo.setDate(validTo.getDate() + parseInt(expiresInResponse));

        const secretName = await vscode.window.showInputBox({
            value: `KeeShepherdGeneratedAzDoPAT${new Date().getMilliseconds()}`,
            prompt: 'Give your new PAT a name'
        });

        if (!!secretName && secretName.startsWith(AnchorPrefix)) {
            throw new Error(`Secret name should not start with ${AnchorPrefix}`);
        }

        if (!secretName) {
            return;
        }

        const patsEndpointUri = `https://vssps.dev.azure.com/${azDoOrg}/_apis/tokens/pats?api-version=7.1-preview.1`;
        await this.checkTokenWithThisNameExists(secretName, patsEndpointUri, accessToken);

        let keyVaultClient;
        let keyVaultName;
        if (controlType === ControlTypeEnum.Managed || ControlTypeEnum.EnvVariable) {
            
            // Need to immediately put managed PATs to KeyVault, because there's no way to retrieve a PAT after it was created.
            // So asking user for a KeyVault name.
            keyVaultName = await KeyVaultSecretValueProvider.pickUpKeyVault(subscription);

            const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
            keyVaultClient = await keyVaultProvider.getKeyVaultClient(subscriptionId, keyVaultName);

            const checkResult = await KeyVaultSecretValueProvider.checkIfSecretExists(keyVaultClient, secretName);
            if (checkResult === 'not-ok-to-overwrite') {
                return;
            }
        }

        // Creating the token
        const requestBody = {
            displayName: secretName,
            scope: scopes,
            validTo: validTo.toISOString(),
            allOrgs: false
        };

        const createTokenResponse = await axios.post(patsEndpointUri, requestBody,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        const token = createTokenResponse?.data?.patToken?.token;

        if (!token) {
            
            throw new Error(`Failed to create PAT. ${createTokenResponse?.data?.patTokenError}`);
        }

        if (!!keyVaultClient) {

            // Storing this PAT in the selected KeyVault
            await keyVaultClient.setSecret(secretName, token);

            // Returning it as a KeyVault secret
            return {
                type: SecretTypeEnum.AzureKeyVault,
                name: secretName,
                value: token,
                properties: {
                    subscriptionId: subscriptionId,
                    keyVaultName,
                    keyVaultSecretName: secretName
                },
                alreadyAskedForName: true
            };
        }

        return {
            type: SecretTypeEnum.AzureDevOpsPats,
            name: secretName,
            value: token,
            properties: {},
            alreadyAskedForName: true
        };
    }

    private async checkTokenWithThisNameExists(name: string, patsEndpointUri: string, accessToken: string): Promise<void> {

        const uri = `${patsEndpointUri}&displayFilterOption=active`;
        let continuationToken = '';

        while (true) {

            const getTokensResponse = await axios.get(`${uri}&continuationToken=${continuationToken}`, { headers: { 'Authorization': `Bearer ${accessToken}` } } );
            
            const tokensBatch = getTokensResponse?.data?.patTokens as { displayName: string }[];

            if (!!tokensBatch && !!tokensBatch.length && tokensBatch.some(t => t.displayName.toLowerCase() === name.toLowerCase())) {
                throw new Error(`An active Personal Access Token named '${name}' already exists in this Azure DevOps org. Select a different name.`);
            }

            continuationToken = getTokensResponse?.data?.continuationToken;
            if (!continuationToken) {
                break;
            }
        }
    }
} 
