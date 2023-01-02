import * as vscode from 'vscode';

import { StorageManagementClient } from '@azure/arm-storage';
import { StorageAccount } from "@azure/arm-storage/src/models";
import { TokenCredential, GetTokenOptions } from "@azure/core-auth";
import { getAuthSession } from './helpers';

// Full typings for this can be found here: https://github.com/microsoft/vscode-azure-account/blob/master/src/azure-account.api.d.ts
export type AzureSubscription = { session: { credentials2: any }, subscription: { subscriptionId: string, displayName: string } };

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

    constructor() {

        // Using Azure Account extension to connect to Azure, get subscriptions etc.
        const azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');

        // Typings for azureAccount are here: https://github.com/microsoft/vscode-azure-account/blob/master/src/azure-account.api.d.ts
        this._account = !!azureAccountExtension ? azureAccountExtension.exports : undefined;
    }

    async picUpStorageAccount(storageManagementClient: StorageManagementClient): Promise<StorageAccount | undefined> {

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
                        label: s.subscription.displayName,
                        description: s.subscription.subscriptionId
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
        
        return this._account.filters;
    }

    // Uses vscode.authentication to get a token with custom scopes
    async getToken(scopes: string[] = ['https://management.core.windows.net/user_impersonation']): Promise<string> {

        const authSession = await getAuthSession('microsoft', scopes);
        
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

    async isSignedIn(): Promise<boolean> {

        return !!this._account && !!(await this._account.waitForFilters());
    }

    async subscriptionsAvailable(): Promise<boolean> {

        return !!this._account && !!(await this._account.waitForFilters()) && (this._account.filters.length > 0);
    }

    private readonly _account: any;
}