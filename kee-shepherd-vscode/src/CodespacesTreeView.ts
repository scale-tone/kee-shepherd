import * as path from 'path';
import * as vscode from 'vscode';

import { Log } from './helpers';
import { CodespaceSecretKind, CodespaceSecretKinds, CodespaceSecretInfo, CodespaceSecretValueProvider } from './secret-value-providers/CodespaceSecretValueProvider';

export enum CodespacesNodeTypeEnum {
    SecretKind = 1,
    Organization,
    Repository,
    Secret,
}

export type CodespacesTreeItem = vscode.TreeItem & {
    
    nodeType: CodespacesNodeTypeEnum,
    secretKind?: CodespaceSecretKind,
    secrets?: CodespaceSecretInfo[],
    orgName?: string,
    repoName?: string,
    secretInfo?: CodespaceSecretInfo
};

// Renders the 'Codespaces Secrets' TreeView
export class CodespacesTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {

    constructor(
        private _resourcesFolder: string,
        private _log: Log
    ) { }

    protected _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined> = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
    
    // Does nothing, actually
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

    // Renders the TreeView
    async getChildren(parent: CodespacesTreeItem): Promise<CodespacesTreeItem[]> {

        let result: CodespacesTreeItem[] = [];

        try {

            switch (parent?.nodeType) {
                
                case undefined: {

                    result = CodespaceSecretKinds.map(secretKind => {

                        return {
                            label: `${secretKind} Secrets`,
                            secretKind,
                            contextValue: `codespaces-${secretKind.toLowerCase()}-secrets`,
                            nodeType: CodespacesNodeTypeEnum.SecretKind,
                            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                        };
                    });

                }
                break;
                case CodespacesNodeTypeEnum.SecretKind: {

                    switch (parent.secretKind) {
                        case 'Personal': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForPersonalSecrets();
                            const secrets = await CodespaceSecretValueProvider.getCodespacesSecrets(`user`, accessToken);

                            for (const secret of secrets) {

                                const node = {
                                    label: secret.name,
                                    secretInfo: secret,
                                    tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                                    nodeType: CodespacesNodeTypeEnum.Secret,
                                    secretKind: 'Personal' as CodespaceSecretKind,
                                    contextValue: 'codespaces-personal-secret',
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
                        case 'Organization': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                            const orgs = await CodespaceSecretValueProvider.getUserOrgs(accessToken);

                            for (const org of orgs) {
                                
                                const node = {
                                    label: org,
                                    orgName: org,
                                    nodeType: CodespacesNodeTypeEnum.Organization,
                                    contextValue: 'codespaces-organization',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                            
                        }
                        break;
                        case 'Repository': {

                            const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForRepoSecrets();
                            const repos = (await CodespaceSecretValueProvider.getUserRepos(accessToken)).map(r => r.fullName);

                            // Only showing repos with secrets in them, so need to load secrets for each repo right away
                            const promises = repos.map(repoFullName => CodespaceSecretValueProvider.getCodespacesSecrets(`repos/${repoFullName}`, accessToken).then(secrets => {
                                return {
                                    repoFullName,
                                    secrets
                                };
                            }).catch(err => {
                                return undefined;
                            }));

                            const reposAndSecrets = (await Promise.all(promises)).filter(res => !!(res?.secrets?.length));
                            
                            for (const repo of reposAndSecrets) {
                                
                                const node = {
                                    label: repo!.repoFullName,
                                    repoName: repo!.repoFullName,
                                    nodeType: CodespacesNodeTypeEnum.Repository,
                                    contextValue: 'codespaces-repository',
                                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                                    secrets: repo!.secrets
                                };
        
                                // Sorting by name on the fly
                                const index = result.findIndex(n => n.label! > node.label);
                                result.splice(index < 0 ? result.length : index, 0, node);
                            }
                        }
                        break;
                    }
                }
                break;
                case CodespacesNodeTypeEnum.Organization: {

                    const accessToken = await CodespaceSecretValueProvider.getGithubAccessTokenForOrgSecrets();
                    const secrets = await CodespaceSecretValueProvider.getCodespacesSecrets(`orgs/${parent.label}`, accessToken);

                    for (const secret of secrets) {

                        const node = {
                            label: secret.name,
                            orgName: parent.orgName,
                            secretInfo: secret,
                            tooltip: `visibility: ${secret.visibility}, created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Organization' as CodespaceSecretKind,
                            contextValue: 'codespaces-organization-secret',
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
                case CodespacesNodeTypeEnum.Repository: {

                    if (!parent.secrets) {
                        return result;
                    }

                    for (const secret of parent.secrets) {

                        const node = {
                            label: secret.name,
                            repoName: parent.repoName,
                            secretInfo: secret,
                            tooltip: `created ${secret.created_at.slice(0, 19)}`,
                            nodeType: CodespacesNodeTypeEnum.Secret,
                            secretKind: 'Repository' as CodespaceSecretKind,
                            contextValue: 'codespaces-repository-secret',
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

        } catch (err: any) {
            vscode.window.showErrorMessage(`KeeShepherd failed to load the Codespaces Secrets view. ${err.message ?? err}`);
        }
        
        return result;
    }
}