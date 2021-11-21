import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SecretTypeEnum, ControlTypeEnum, ControlledSecret, } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';

export enum NodeTypeEnum {
    Machine = 1,
    Folder,
    File,
    Secret
}

export type KeyShepherdTreeItem = vscode.TreeItem & {
    
    nodeType: NodeTypeEnum,
    isLocal: boolean,
    filePath?: string,
    machineName?: string,
    folderUri?: string,
    command?: {
        arguments: ControlledSecret[]
    }
};

// Renders the 'Secrets' TreeView
export class SecretTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(private _getRepo: () => IKeyMetadataRepo, private _resourcesFolder: string) {}

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: KeyShepherdTreeItem): Promise<KeyShepherdTreeItem[]> {

        const result: KeyShepherdTreeItem[] = [];

        try {

            switch (parent?.nodeType) {
                
                case undefined: {

                    const machineNames = await this._getRepo().getMachineNames();

                    for (const machineName of machineNames) {
                        
                        const isLocal = machineName === os.hostname();
        
                        const collapsibleState = isLocal ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        
                        const node = {
                            label: machineName,
                            nodeType: NodeTypeEnum.Machine,
                            collapsibleState,
                            isLocal,
                            description: isLocal ? '(this machine)' : '',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'machine.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'machine.svg')
                            }
                        }

                        // Sorting by name on the fly, but placing local machine on top
                        const index = result.findIndex(n =>
                            (!n.isLocal && n.label! > node.label) ||
                            !!node.isLocal);
                        
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case NodeTypeEnum.Machine: {

                    const workspaceFolders = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) : [];
                    const machineName = parent.label as string;
        
                    const folderUris = await this._getRepo().getFolders(machineName);

                    for (const folderUri of folderUris) {
                        
                        var label = decodeURIComponent(folderUri);
                        if (label.startsWith('file:///')) {
                            label = label.substr(8);
                        }
        
                        const collapsibleState = workspaceFolders.includes(folderUri) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
        
                        const node = {
                            label,
                            machineName,
                            nodeType: NodeTypeEnum.Folder,
                            folderUri,
                            collapsibleState,
                            isLocal: parent.isLocal,
                            contextValue: parent.isLocal ? 'tree-folder-local' : 'tree-folder',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'folder.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'folder.svg')
                            }
                        }

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case NodeTypeEnum.Folder: {

                    const folderUri = parent.folderUri!;
                    const secrets = await this._getRepo().getSecrets(folderUri, false, parent.machineName);
        
                    const filePaths: any = {};
                    for (var secret of secrets) {
        
                        const fileName = path.basename(secret.filePath);
                        const fileFolderUri = secret.filePath.substr(0, secret.filePath.length - fileName.length - 1);
                        if (fileFolderUri.toLowerCase() === folderUri.toLowerCase()) {
        
                            filePaths[secret.filePath] = decodeURIComponent(fileName);                    
                        }
                    }

                    for (const filePath of Object.keys(filePaths)) {
                        
                        const node = {
                            label: filePaths[filePath],
                            filePath,
                            machineName: parent.machineName,
                            nodeType: NodeTypeEnum.File,
                            collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
                            isLocal: parent.isLocal,
                            contextValue: parent.isLocal ? 'tree-file-local' : 'tree-file',
                            iconPath: {
                                light: path.join(this._resourcesFolder, 'light', 'file.svg'),
                                dark: path.join(this._resourcesFolder, 'dark', 'file.svg')
                            }
                        };

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
                case NodeTypeEnum.File: {

                    const secrets = await this._getRepo().getSecrets(parent.filePath!, true, parent.machineName);

                    for (const secret of secrets) {

                        const description = `${ControlTypeEnum[secret.controlType]}, ${SecretTypeEnum[secret.type]}`;
        
                        // This is what happens when this tree node is being clicked
                        const command = parent.isLocal ? {
                            title: 'Open',
                            command: 'key-shepherd-vscode.view-context.gotoSecret',
                            arguments: [secret]
                        } : undefined;
        
                        const node = {
                            label: secret.name,
                            description,
                            nodeType: NodeTypeEnum.Secret,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,
                            command,
                            isLocal: parent.isLocal,
                            contextValue: parent.isLocal ? 'tree-secret-local' : 'tree-secret',
                            iconPath: path.join(this._resourcesFolder, 'secret.svg')
                        }

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
            }
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeyShepherd failed to load the secrets view. ${(err as any).message ?? err}`);
        }

        return result;
    }
}