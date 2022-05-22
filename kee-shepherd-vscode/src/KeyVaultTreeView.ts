import * as path from 'path';
import * as vscode from 'vscode';

import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';

export enum KeyVaultNodeTypeEnum {
    Subscription = 1,
    KeyVault,
    Secret,
}

export type KeyVaultTreeItem = vscode.TreeItem & {
    
    nodeType: KeyVaultNodeTypeEnum,
    credentials?: DeviceTokenCredentials,
    subscriptionId: string,
    keyVaultName?: string
};

// Renders the 'Key Vault' TreeView
export class KeyVaultTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(
        private _account: AzureAccountWrapper,
        private _resourcesFolder: string,
        private _log: (s: string, withEof: boolean, withTimestamp: boolean) => void
    ) { }

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
    
    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: KeyVaultTreeItem): Promise<KeyVaultTreeItem[]> {

        const result: KeyVaultTreeItem[] = [];

        try {
            switch (parent?.nodeType) {
                
                case undefined: {

                    const subscriptions = await this._account.getSubscriptions();

                    for (const subscription of subscriptions) {

                        const node = {
                            label: subscription.subscription.displayName,
                            nodeType: KeyVaultNodeTypeEnum.Subscription,
                            credentials: subscription.session.credentials2,
                            subscriptionId: subscription.subscription.subscriptionId,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                            iconPath: path.join(this._resourcesFolder, 'azureSubscription.svg')
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case KeyVaultNodeTypeEnum.Subscription: {

                    const resourceGraphClient = new ResourceGraphClient(parent.credentials!);
    
                    const response = await resourceGraphClient.resources({
                        subscriptions: [parent.subscriptionId],
                        query: 'resources | where type == "microsoft.keyvault/vaults"'
                    });

                    if (!!response.data && !!response.data.length) {

                        for (const vault of response.data) {
                            
                            const node = {
                                label: vault.name,
                                keyVaultName: vault.name,
                                nodeType: KeyVaultNodeTypeEnum.KeyVault,
                                subscriptionId: parent.subscriptionId,
                                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                iconPath: {
                                    light: path.join(this._resourcesFolder, 'light', 'key-vault.svg'),
                                    dark: path.join(this._resourcesFolder, 'dark', 'key-vault.svg')
                                }
                            };
    
                            // Sorting by name on the fly
                            const index = result.findIndex(n => n.label! > node.label);
                            result.splice(index < 0 ? result.length : index, 0, node);    
                        }
                    }
                }
                break;
                case KeyVaultNodeTypeEnum.KeyVault: {

                    const secretProvider = new KeyVaultSecretValueProvider(this._account);
                    const secretNames = await secretProvider.getSecretNames(parent.subscriptionId, parent.label as string);

                    for (const secretName of secretNames) {
                        
                        const node = {
                            label: secretName,
                            nodeType: KeyVaultNodeTypeEnum.Secret,
                            contextValue: 'key-vault-secret',
                            subscriptionId: parent.subscriptionId,
                            keyVaultName: parent.keyVaultName,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,

                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'secret.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'secret.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);    
                    }
                }
                break;
            }
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the Key Vault view. ${(err as any).message ?? err}`);
        }
        
        return result;
    }
}