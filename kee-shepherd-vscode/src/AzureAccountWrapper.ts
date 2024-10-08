import * as vscode from 'vscode';

import { StorageManagementClient } from '@azure/arm-storage';
import { StorageAccount } from "@azure/arm-storage/src/models";
import { TokenCredential, GetTokenOptions } from "@azure/core-auth";

import { VSCodeAzureSubscriptionProvider, AzureSubscription } from '@microsoft/vscode-azext-azureauth';

export interface TokenResponse {
    tokenType: string;
    expiresIn: number;
    expiresOn: Date | string;
    resource: string;
    accessToken: string;
    refreshToken?: string;
}

// Wraps Azure Acccount extension
export class AzureAccountWrapper {

    async pickUpStorageAccount(storageManagementClient: StorageManagementClient): Promise<StorageAccount | undefined> {

        const storageAccounts: StorageAccount[] = [];

        var storageAccountsPartialResponse = await storageManagementClient.storageAccounts.list();
        storageAccounts.push(...storageAccountsPartialResponse);

        while (!!storageAccountsPartialResponse.nextLink) {

            storageAccountsPartialResponse = await storageManagementClient.storageAccounts.listNext(storageAccountsPartialResponse.nextLink);
            storageAccounts.push(...storageAccountsPartialResponse);
        }

        if (storageAccounts.length <= 0) {
            throw new Error('No storage accounts found in this subscription');
        }

        const storageAccount = await vscode.window.showQuickPick(storageAccounts.map(account => {
                return {
                    label: account.name!,
                    detail: `(${account.kind}, ${account.location})`,
                    account
                };
            }), 
            { title: 'Select Storage Account' }
        );

        if (!storageAccount) {
            return;
        }

        return storageAccount.account;
    }

    async pickUpSubscription(): Promise<AzureSubscription | undefined> {
        
        // Picking up a subscription
        const subscriptions = await this.getSubscriptions();

        if (subscriptions.length <= 0) {
            throw new Error(`Select at least one subscription in the Azure Account extension`);
        }
        
        var subscription: AzureSubscription;

        if (subscriptions.length > 1) {

            const pickResult = await vscode.window.showQuickPick(
                subscriptions.map(s => {
                    return {
                        subscription: s,
                        label: s.name,
                        description: s.subscriptionId
                    };
                }),
                { title: 'Select Azure Subscription' }
            );

            if (!pickResult) {
                return;
            }
                
            subscription = pickResult.subscription;

        } else {

            subscription = subscriptions[0];
        }

        return subscription;
    }

    async getSubscriptions(): Promise<AzureSubscription[]> {

        if (!(await this.isSignedIn())) {
            throw new Error(`You need to be signed in to Azure for this. Execute 'Azure: Sign In' command.`);
        }
        
        return this._provider.getSubscriptions(true);
    }

    // Uses vscode.authentication to get a token with custom scopes
    async getToken(scopes: string[] = ['https://management.core.windows.net/user_impersonation']): Promise<string> {

        const authSession = await this.getAuthSession(scopes);
        
        return authSession.accessToken;
    }

    // Uses vscode.authentication to get a TokenCredential object for custom scopes
    async getTokenCredential(scopes: string[] = ['https://management.core.windows.net/user_impersonation']): Promise<TokenCredential> {

        const accessToken = await this.getToken(scopes);

        // Need to extract expiration time from token
        let expiresOnTimestamp = new Date().getTime() + 60 * 1000;

        const tokenJson = Buffer.from(accessToken, 'base64').toString();

        const match = /"exp"\s*:\s*(\d+)/i.exec(tokenJson);
        if (!!match) {

            const exp = match[1];
            expiresOnTimestamp = parseInt(exp) * 1000;
        }

        return {

            getToken: async (scopes: string | string[], options?: GetTokenOptions) => {

                return {
                    token: accessToken,
                    expiresOnTimestamp
                };
            }
        };
    }

    async signIn(): Promise<boolean> {

        return this._provider.signIn();
    }

    async isSignedIn(): Promise<boolean> {

        return this._provider.isSignedIn();
    }

    async subscriptionsAvailable(): Promise<boolean> {

        return (await this._provider.getSubscriptions(true)).length > 0;
    }

    private readonly _provider: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();

    private async getAuthSession(scopes: string[]): Promise<vscode.AuthenticationSession> {

        const providerId = 'microsoft';

        // Trying to clarify the correct tenantId
        const subscriptions = await this.getSubscriptions();
        if (!!subscriptions?.length) {

            const tenantId = subscriptions[0].tenantId;
            if (!!tenantId) {
                
                scopes.push(`VSCODE_TENANT:${tenantId}`);
            }
        }

        // First trying silent mode
        let authSession = await vscode.authentication.getSession(providerId, scopes, { silent: true });

        if (!!authSession) {
            
            return authSession;
        }

        // Now asking to authenticate, if needed
        authSession = await vscode.authentication.getSession(providerId, scopes, { createIfNone: true });

        return authSession;        
    }
}