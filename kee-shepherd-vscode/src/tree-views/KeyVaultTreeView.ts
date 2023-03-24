import * as path from 'path';
import * as vscode from 'vscode';

import { DeviceTokenCredentials } from '@azure/ms-rest-nodeauth';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { AzureAccountWrapper } from '../AzureAccountWrapper';
import { KeyVaultSecretValueProvider } from '../secret-value-providers/KeyVaultSecretValueProvider';
import { askUserForSecretName, Log, timestampToString } from '../helpers';
import { ControlTypeEnum } from '../KeyMetadataHelpers';
import { SecretValuesProvider } from '../SecretValuesProvider';
import { TreeViewBase } from './TreeViewBase';

export enum KeyVaultNodeTypeEnum {
    Subscription = 1,
    KeyVault,
    Secret,
    SecretVersion,
    ErrorNode,
    InitialCommand
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
export class KeyVaultTreeView extends TreeViewBase implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(private readonly _account: AzureAccountWrapper,  private readonly _valuesProvider: SecretValuesProvider, resourcesFolder: string, log: Log) { 
        super(resourcesFolder, log);
    }

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

                    if (!!await this._account.isSignedIn()) {
                     
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
                            
                    } else {

                        result.push({
                            label: 'Sign in to Azure...',
                            nodeType: KeyVaultNodeTypeEnum.InitialCommand,
                            command: {
                                title: 'Sign in to Azure...',
                                command: 'azure-account.login',
                                arguments: []
                            }
                        });
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
                        const secrets = await secretProvider.getSecrets(parent.label as string);
    
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

                        const secretVersions = await secretProvider.getSecretVersions(parent.keyVaultName!, parent.label as string);
    
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

    async copyKeyVaultSecretValueOrUri(treeItem: KeyVaultTreeItem, copyUri: boolean): Promise<void> {

        if ((treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret && treeItem.nodeType !== KeyVaultNodeTypeEnum.SecretVersion) ||
            !treeItem.subscriptionId ||
            !treeItem.keyVaultName ||
            !treeItem.secretId) {
            return;
        }

        const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
        const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.keyVaultName);

        const secret = await keyVaultClient.getSecret(treeItem.secretId);

        if (!!copyUri) {

            vscode.env.clipboard.writeText(
                treeItem.nodeType === KeyVaultNodeTypeEnum.Secret ? 
                `${secret.properties.vaultUrl}/secrets/${secret.name}` :
                secret.properties.id!
            );

        } else {

            vscode.env.clipboard.writeText(secret.value as string);
        }

        vscode.window.showInformationMessage(`KeeShepherd: ${copyUri ? 'URI' : 'value'} of ${treeItem.secretId} was copied to Clipboard`);
    }

    async createKeyVaultSecret(treeItem: KeyVaultTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        if (treeItem.nodeType !== KeyVaultNodeTypeEnum.KeyVault || !treeItem.subscriptionId || !treeItem.keyVaultName) {
            return;
        }

        let secretName;
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            secretName = !!secret.alreadyAskedForName ? secret.name : await askUserForSecretName(secret.name);
            if (!secretName) {
                return;
            }
                
            secretValue = secret.value;
            
        } else {

            secretName = await askUserForSecretName();
            if (!secretName) {
                return;
            }
    
            secretValue = await this.askUserForSecretValue();
        }

        if (!secretValue) {
            return;
        }

        const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
        const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.keyVaultName);

        const checkResult = await KeyVaultSecretValueProvider.checkIfSecretExists(keyVaultClient, secretName);
        if (checkResult === 'not-ok-to-overwrite') {
            return;
        }
        
        await keyVaultClient.setSecret(secretName, secretValue);

        this.refresh();

        if (checkResult === 'does-not-exist') {
            
            this._log(`Created ${secretName} in ${treeItem.keyVaultName} Key Vault`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: ${secretName} was created in Key Vault`);

        } else {

            this._log(`Added a new version of ${secretName} to ${treeItem.keyVaultName} Key Vault`, true, true);
            vscode.window.showInformationMessage(`KeeShepherd: new version of ${secretName} was added to Key Vault`);
        }
    }

    async setKeyVaultSecretValue(treeItem: KeyVaultTreeItem, pickUpSecretValue: boolean = false): Promise<void> {

        if (treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret || !treeItem.subscriptionId || !treeItem.keyVaultName) {
            return;
        }

        const secretName = treeItem.label as string;
        let secretValue;

        if (!!pickUpSecretValue) {

            const secret = await this._valuesProvider.pickUpSecret(ControlTypeEnum.Supervised);
            if (!secret) {
                return;
            }

            secretValue = secret.value;
            
        } else {

            secretValue = await this.askUserForSecretValue();
        }

        if (!secretValue) {
            return;
        }

        const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
        const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.keyVaultName);

        await keyVaultClient.setSecret(secretName, secretValue);

        this.refresh();

        this._log(`Added a new version of ${secretName} to ${treeItem.keyVaultName} Key Vault`, true, true);
        vscode.window.showInformationMessage(`KeeShepherd: new version of ${secretName} was added to Key Vault`);
    }

    async removeSecretFromKeyVault(treeItem: KeyVaultTreeItem): Promise<void> {

        if (treeItem.nodeType !== KeyVaultNodeTypeEnum.Secret || !treeItem.subscriptionId || !treeItem.keyVaultName) {
            return;
        }

        const userResponse = await vscode.window.showWarningMessage(
            `Secret ${treeItem.label} will be removed ("soft-deleted") from Key Vault. Do you want to proceed?`,
            'Yes', 'No');

        if (userResponse !== 'Yes') {
            return;
        }

        const keyVaultProvider = new KeyVaultSecretValueProvider(this._account);
        const keyVaultClient = await keyVaultProvider.getKeyVaultClient(treeItem.keyVaultName);

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Removing secret from Key Vault...`
        };

        await vscode.window.withProgress(progressOptions, async () => { 

            const poller = await keyVaultClient.beginDeleteSecret(treeItem.label as string);
            const removedSecret = await poller.pollUntilDone();

            this._log(`Removed ${removedSecret.name} from ${treeItem.keyVaultName} Key Vault`, true, true);
        });

        this.refresh();

        vscode.window.showInformationMessage(`KeeShepherd: ${treeItem.label} was removed from Key Vault`);
    }
}