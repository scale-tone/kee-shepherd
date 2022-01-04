import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SecretTypeEnum, ControlTypeEnum, ControlledSecret, getAnchorName } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { KeeShepherdBase } from './KeeShepherdBase';

export enum NodeTypeEnum {
    Machine = 1,
    Folder,
    File,
    Secret
}

export type KeeShepherdTreeItem = vscode.TreeItem & {
    
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

    setSecretNodeState(filePath: string, secretName: string, stashed: boolean): void {

        const node = this._secretNodes[filePath + secretName];
        if (!!node) {

            node.iconPath = path.join(this._resourcesFolder, !!stashed ? 'secret-stashed.svg' : 'secret-unstashed.svg');

            this._onDidChangeTreeData.fire(node);
        }
    }

    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: KeeShepherdTreeItem): Promise<KeeShepherdTreeItem[]> {

        const result: KeeShepherdTreeItem[] = [];

        try {

            switch (parent?.nodeType) {
                
                case undefined: {

                    this._secretNodes = {};

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

                    // Obtaining the file text in parallel
                    const fileTextPromise = !parent.isLocal ?
                        Promise.resolve('') :
                        KeeShepherdBase.readFile(vscode.Uri.parse(parent.filePath!)).catch(() => '');

                    const secrets = await this._getRepo().getSecrets(parent.filePath!, true, parent.machineName);

                    for (const secret of secrets) {

                        const description = `${ControlTypeEnum[secret.controlType]}, ${SecretTypeEnum[secret.type]}`;
        
                        // This is what happens when this tree node is being clicked
                        const command = parent.isLocal ? {
                            title: 'Open',
                            command: 'kee-shepherd-vscode.view-context.gotoSecret',
                            arguments: [secret]
                        } : undefined;

                        var icon = 'secret.svg';

                        if (secret.controlType === ControlTypeEnum.Supervised) {
                            
                            var icon = 'secret-supervised.svg';

                        } else {

                            const fileText = await fileTextPromise;
                            if (!!fileText) {

                                const anchorName = getAnchorName(secret.name);
                                icon = fileText.includes(anchorName) ? 'secret-stashed.svg' : 'secret-unstashed.svg';
                            }
                        }

                        const node = {
                            label: secret.name,
                            description,
                            nodeType: NodeTypeEnum.Secret,
                            collapsibleState: vscode.TreeItemCollapsibleState.None,
                            command,
                            isLocal: parent.isLocal,
                            contextValue: parent.isLocal ? 'tree-secret-local' : 'tree-secret',
                            iconPath: path.join(this._resourcesFolder, icon)
                        }

                        if (!!parent.isLocal) {

                            // Also saving this node in the secrets node map, to be able to refresh these tree nodes later
                            this._secretNodes[secret.filePath + secret.name] = node;
                        }

                        // Sorting by name on the fly
                        const index = result.findIndex(n => n.label! > node.label);
                        result.splice(index < 0 ? result.length : index, 0, node);
                    }
                }
                break;
            }
                
        } catch (err) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the secrets view. ${(err as any).message ?? err}`);
        }

        return result;
    }

    private _secretNodes: { [id: string]: { iconPath: string } } = {};
}