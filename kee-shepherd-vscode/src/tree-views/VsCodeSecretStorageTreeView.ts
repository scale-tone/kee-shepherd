import * as path from 'path';
import * as vscode from 'vscode';

import { askUserForSecretName, Log } from '../helpers';
import { SettingNames } from '../KeeShepherd';
import { ControlTypeEnum } from '../KeyMetadataHelpers';
import { SecretValuesProvider } from '../SecretValuesProvider';
import { TreeViewBase } from './TreeViewBase';

// Renders the 'VsCode Secret Storage' TreeView
export class VsCodeSecretStorageTreeView extends TreeViewBase implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(
        protected readonly _context: vscode.ExtensionContext,
        private readonly _valuesProvider: SecretValuesProvider,
        resourcesFolder: string,
        log: Log
    ) { 
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
    async getChildren(parent: vscode.TreeItem): Promise<vscode.TreeItem[]> {

        const result: vscode.TreeItem[] = [];

        try {

            const secretNames = this._context.globalState.get(SettingNames.VsCodeSecretStorageSecretNames) as string[] ?? [];

            for (const secretName of secretNames) {
                
                const node = {
                    label: secretName,
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
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the VsCode SecretStorage view. ${(err as any).message ?? err}`);
        }
        
        return result;
    }

    async createSecret(pickUpSecretValue: boolean = false): Promise<void> {

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

        if (!!(await this._context.secrets.get(secretName))) {

            const userResponse = await vscode.window.showWarningMessage(
                `A secret named ${secretName} already exists in VsCode SecretStorage. Do you want to overwrite it?`,
                'Yes', 'No');
   
            if (userResponse !== 'Yes') {
                return;
            }
        }

        await this._context.secrets.store(secretName, secretValue);

        const secretNames = this._context.globalState.get(SettingNames.VsCodeSecretStorageSecretNames) as string[] ?? [];

        if (!secretNames.includes(secretName)) {
            secretNames.push(secretName);
        }

        await this._context.globalState.update(SettingNames.VsCodeSecretStorageSecretNames, secretNames);

        this.refresh();
        vscode.window.showInformationMessage(`KeeShepherd: secret ${secretName} was created`);
    }

    async removeSecret(treeItem: vscode.TreeItem): Promise<void> {

        const secretName = treeItem.label as string;

        const userResponse = await vscode.window.showWarningMessage(
            `Are you sure you want to remove secret ${secretName}?`,
            'Yes', 'No');

        if (userResponse !== 'Yes') {
            return;
        }

        await this._context.secrets.delete(secretName);

        const secretNames = this._context.globalState.get(SettingNames.VsCodeSecretStorageSecretNames) as string[] ?? [];

        let i;
        while ((i = secretNames.indexOf(secretName)) !== -1) {
            secretNames.splice(i, 1);
        }

        await this._context.globalState.update(SettingNames.VsCodeSecretStorageSecretNames, secretNames);

        this.refresh();
        vscode.window.showInformationMessage(`KeeShepherd: secret ${secretName} was removed`);
    }

    async copySecretValue(treeItem: vscode.TreeItem): Promise<void> {

        const secretName = treeItem.label as string;
        const secretValue = await this._context.secrets.get(secretName);

        if (!secretValue) {
            throw new Error(`Failed to get secret value`);
        }

        vscode.env.clipboard.writeText(secretValue);

        vscode.window.showInformationMessage(`KeeShepherd: value of ${secretName} was copied to Clipboard`);
    }
}