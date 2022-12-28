import * as vscode from 'vscode';

import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';
import { Environment } from "@azure/ms-rest-azure-env";
import { StorageManagementClient } from '@azure/arm-storage';
import { StorageAccount } from "@azure/arm-storage/src/models";

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

class SequentialDeviceTokenCredentials extends DeviceTokenCredentials {

    public getToken(): Promise<TokenResponse> {

        // Parallel execution of super.getToken() leads to https://github.com/microsoft/vscode-azure-account/issues/53
        // Therefore we need to make sure this method is always invoked sequentially, and we're doing that with this simple Active Object pattern implementation
        
        return SequentialDeviceTokenCredentials.executeSequentially(() => super.getToken());
    }

    private static _workQueue: Promise<any> = Promise.resolve();

    private static executeSequentially<T>(action: () => Promise<T>): Promise<T> {
    
        // What goes to _workQueue should never throw (otherwise that exception will always get re-thrown later).
        // That's why we wrap it all with a new Promise(). This promise will resolve only _after_ action completes (or fails).
        return new Promise((resolve, reject) => {
    
            this._workQueue = this._workQueue.then(() => action().then(resolve, reject));
        });
    }
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
        await this.checkSignIn();
        return this._account.filters;
    }

    async getTokenCredentials(subscriptionId: string, resourceId: string | undefined = undefined): Promise<DeviceTokenCredentials> {

        const subscription = (await this.getSubscriptions()).find(s => s.subscription.subscriptionId === subscriptionId);

        if (!subscription) {
            throw new Error(`Invalid subscriptionId '${subscriptionId}'`);
        }

        const tokenCredential = subscription.session.credentials2 as DeviceTokenCredentials;
        const environment = tokenCredential.environment;

        return new SequentialDeviceTokenCredentials(

            tokenCredential.clientId,
            tokenCredential.domain,
            tokenCredential.username,
            tokenCredential.tokenAudience,
            new Environment({
                name: environment.name,
                portalUrl: environment.portalUrl,
                managementEndpointUrl: environment.managementEndpointUrl,
                resourceManagerEndpointUrl: environment.resourceManagerEndpointUrl,
                activeDirectoryEndpointUrl: environment.activeDirectoryEndpointUrl,
                activeDirectoryResourceId: resourceId ?? environment.activeDirectoryResourceId
            }),
            tokenCredential.tokenCache
        );
    }

    async getTokenWithScopes(scopes: string[]): Promise<string> {

        // First trying silent mode
        let authSession = await vscode.authentication.getSession('microsoft', scopes, { silent: true });

        if (!!authSession) {
            
            return authSession.accessToken;
        }

        // Now asking to authenticate, if needed
        authSession = await vscode.authentication.getSession('microsoft', scopes, { createIfNone: true });

        return authSession.accessToken;
    }

    async isSignedIn(): Promise<boolean> {

        return !!this._account && !!(await this._account.waitForFilters());
    }

    private readonly _account: any;

    private async checkSignIn(): Promise<void> {

        if (!(await this.isSignedIn())) {
            throw new Error(`You need to be signed in to Azure for this. Execute 'Azure: Sign In' command.`);
        }
    }
}