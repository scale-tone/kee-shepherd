import * as path from 'path';
import * as vscode from 'vscode';

import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { KeyVaultSecretValueProvider } from './secret-value-providers/KeyVaultSecretValueProvider';
import { timestampToString } from './helpers';

export enum KeyVaultNodeTypeEnum {
    Subscription = 1,
    KeyVault,
    Secret,
    SecretVersion,
    ErrorNode
}

export type KeyVaultTreeItem = vscode.TreeItem & {
    
    nodeType: KeyVaultNodeTypeEnum,
    credentials?: DeviceTokenCredentials,
    subscriptionId?: string,
    keyVaultName?: string,
    secretId?: string,
    updatedOn?: Date
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
                            tooltip: subscription.subscription.subscriptionId,
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
                        subscriptions: [parent.subscriptionId as string],
                        query: 'resources | where type == "microsoft.keyvault/vaults"'
                    });

                    if (!!response.data && !!response.data.length) {

                        for (const vault of response.data) {
                            
                            const node = {
                                label: vault.name,
                                tooltip: !!vault.resourceGroup ? `resource group: ${vault.resourceGroup}` : ``,
                                keyVaultName: vault.name,
                                nodeType: KeyVaultNodeTypeEnum.KeyVault,
                                contextValue: 'key-vault',
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

                    try {
                     
                        const secretProvider = new KeyVaultSecretValueProvider(this._account);
                        const secrets = await secretProvider.getSecrets(parent.subscriptionId as string, parent.label as string);
    
                        for (const secret of secrets) {
                            
                            const node = {
                                label: secret.name,
                                tooltip: timestampToString(secret.createdOn as Date),
                                nodeType: KeyVaultNodeTypeEnum.Secret,
                                contextValue: 'key-vault-secret',
                                subscriptionId: parent.subscriptionId,
                                secretId: secret.name,
                                keyVaultName: parent.keyVaultName,
                                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
    
                                iconPath: {
                                    light: path.join(this._resourcesFolder, 'light', 'secret.svg'),
                                    dark: path.join(this._resourcesFolder, 'dark', 'secret.svg')
                                }
                            };
    
                            // Sorting by name on the fly
                            const index = result.findIndex(n => n.label! > node.label);
                            result.splice(index < 0 ? result.length : index, 0, node);    
                        }                            

                    } catch (err: any) {

                        result.push({
                            label: `Failed to load secrets. ${err.message ?? err}`,
                            nodeType: KeyVaultNodeTypeEnum.ErrorNode,
                        });
                    }
                }
                break;
                case KeyVaultNodeTypeEnum.Secret: {

                    try {
                     
                        const secretProvider = new KeyVaultSecretValueProvider(this._account);

                        const secretVersions = await secretProvider.getSecretVersions(parent.subscriptionId as string, parent.keyVaultName!, parent.label as string);
    
                        for (const secretVersion of secretVersions) {
                            
                            const node = {
                                label: secretVersion.version,
                                updatedOn: secretVersion.updatedOn,
                                tooltip: timestampToString(secretVersion.createdOn as Date),
                                nodeType: KeyVaultNodeTypeEnum.SecretVersion,
                                contextValue: 'key-vault-secret-version',
                                subscriptionId: parent.subscriptionId,
                                secretId: `${secretVersion.name}/${secretVersion.version}`,
                                keyVaultName: parent.keyVaultName,
                                collapsibleState: vscode.TreeItemCollapsibleState.None,
    
                                iconPath: {
                                    light: path.join(this._resourcesFolder, 'light', 'secret-version.svg'),
                                    dark: path.join(this._resourcesFolder, 'dark', 'secret-version.svg')
                                }
                            };
 
                            // Sorting by updatedOn on the fly
                            const index = result.findIndex(n => n.updatedOn! < node.updatedOn!);
                            result.splice(index < 0 ? result.length : index, 0, node);
                        }                            

                    } catch (err: any) {

                        result.push({
                            label: `Failed to load secret versions. ${err.message ?? err}`,
                            nodeType: KeyVaultNodeTypeEnum.ErrorNode,
                        });
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