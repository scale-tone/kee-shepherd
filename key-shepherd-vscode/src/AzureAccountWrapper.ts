import * as vscode from 'vscode';

import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';
import { Environment } from "@azure/ms-rest-azure-env";

// Full typings for this can be found here: https://github.com/microsoft/vscode-azure-account/blob/master/src/azure-account.api.d.ts
export type AzureSubscription = { session: { credentials2: any }, subscription: { subscriptionId: string, displayName: string } };

export class AzureAccountWrapper {

    private readonly _account: any;

    constructor() {

        // Using Azure Account extension to connect to Azure, get subscriptions etc.
        const azureAccountExtension = vscode.extensions.getExtension('ms-vscode.azure-account');

        // Typings for azureAccount are here: https://github.com/microsoft/vscode-azure-account/blob/master/src/azure-account.api.d.ts
        this._account = !!azureAccountExtension ? azureAccountExtension.exports : undefined;
    }

    async getSubscriptions(): Promise<AzureSubscription[]> {
        await this.checkSignIn();
        return this._account.filters;
    }

    async getTokenCredentials(subscriptionId: string, resourceId: string = ''): Promise<DeviceTokenCredentials> {

        const subscription = (await this.getSubscriptions()).find(s => s.subscription.subscriptionId === subscriptionId);

        if (!subscription) {
            throw new Error(`Invalid subscriptionId '${subscriptionId}'`);
        }

        if (!resourceId) {
            
            // Assuming the default resourceId and returning default credentials object
            return subscription.session.credentials2 as DeviceTokenCredentials;
        }

        const tokenCredential = subscription.session.credentials2 as DeviceTokenCredentials;
        const environment = tokenCredential.environment;

        // Need to provide the correct resourceId for the token.
        // So copying all fields from Azure Account ext
        // except newEnvironment.activeDirectoryResourceId

        return new DeviceTokenCredentials (
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
                activeDirectoryResourceId: resourceId
            }),
            tokenCredential.tokenCache
        );
    }

    private async checkSignIn(): Promise<void> {

        if (!this._account || !await this._account.waitForFilters()) {
            throw new Error('You need to be signed in to Azure for this');
        }
    }
}