import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';
import axios from "axios";

const execAsync = util.promisify(cp.exec);

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";
import { Log } from '../helpers';

export const CodespaceSecretKinds = ['Personal', 'Organization', 'Repository'] as const;
export type CodespaceSecretKind = typeof CodespaceSecretKinds[number];
export type CodespaceSecretMeta = { name: string, created_at: string, updated_at: string, visibility: string };

// Implements picking and retrieving secret values from GitHub Codespace Secrets
export class CodespaceSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper, private _log: Log) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        this._log(`>> ${secret.name}:${process.env[secret.name]} <<<`, true, true);

        // Codespace Secrets appear as env variables, so we just take the value from there
        return process.env[secret.name] as string;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const secretKindOptions = [
            {
                label: 'Personal',
                secretKind: 'Personal' as CodespaceSecretKind
            },
            {
                label: 'Organization',
                secretKind: 'Organization' as CodespaceSecretKind
            }
        ];
        
        const githubRepoName = await this.getGitHubRepoFullName();
        if (!!githubRepoName) {
            
            secretKindOptions.push({
                label: `Repository (${githubRepoName})`,
                secretKind: 'Repository' as CodespaceSecretKind
            });
        }
        
        const secretKindSelectedOption = (await vscode.window.showQuickPick(secretKindOptions, { title: 'Select Codespaces Secret Kind' }));
        if (!secretKindSelectedOption) {
            return;
        }
        
        const secretKind = secretKindSelectedOption.secretKind;
        let secretName = '';

        let options: { label: string, kind?: vscode.QuickPickItemKind, detail?: string }[] = [];

        switch (secretKind) {
            case 'Personal':
                options = await this.getQuickPickOptionsForPersonalSecrets();
            break;
            case 'Organization':
                options = await this.getQuickPickOptionsForOrganizationSecrets();
            break;
            case 'Repository':
                options = await this.getQuickPickOptionsForRepoSecrets(githubRepoName);
            break;
        }

        if (!options.length) {

            throw new Error(`No Codespaces ${secretKind} secrets found`);
        }
    
        const selectedOption = await vscode.window.showQuickPick(options, { title: 'Select Codespaces Secret' });
        if (!selectedOption) {
            return;
        }
        
        secretName = selectedOption.label;

        const secretValue = process.env[secretName];
        if (!secretValue) {

            throw new Error(`Failed to get the value of ${secretName}. If you just created it, you might need to reload your Codespaces instance for that secret to take effect. Also make sure that this secret is available for current repository.`);
        }

        return {
            type: SecretTypeEnum.Codespaces,
            name: secretName,
            value: secretValue!,
            properties: {
                kind: secretKind
            }
        };
    }

    private async getGitHubRepoFullName(): Promise<string> {

        const projectFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        if (!projectFolder) {
            return '';
        }

        // looking for .git folder
        var localGitFolder = projectFolder;
        while (!fs.existsSync(path.join(localGitFolder, '.git'))) {
        
            const parentFolder = path.dirname(localGitFolder);

            if (!parentFolder || localGitFolder === parentFolder) {
                return '';
            }

            localGitFolder = parentFolder;
        }

        let originUrl = '';
        try {

            const execParams = { env: { GIT_DIR: path.join(localGitFolder, '.git') } };

            originUrl = (await execAsync('git config --get remote.origin.url', execParams))
                .stdout
                .toString()
                .replace(/\n+$/, '') // trims end-of-line, if any
                .replace(/\/+$/, ''); // trims the trailing slash, if any
                    
        } catch (err: any) {

            this._log(`Failed to get remote origin URL. ${err.message ?? err}`, true, true);
            
            return '';
        }

        // Dropping credentials, if any
        originUrl = originUrl.replace(/:\/\/[^\/]*@/i, '://');

        if (originUrl.toLowerCase().endsWith('.git')) {
            originUrl = originUrl.substring(0, originUrl.length - 4);
        }

        const githubUrl = 'https://github.com/';
        if (!originUrl.toLowerCase().startsWith(githubUrl)) {

            this._log(`Remote origin URL (${originUrl}) does not look like a GitHub repo`, true, true);
            
            return '';
        }

        return originUrl.substring(githubUrl.length);
    }

    private getRequestHeaders(accessToken: string): any {
        
        return { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' } };
    }

    private async getCodespacesSecrets(secretsUri: string, accessToken: string): Promise<CodespaceSecretMeta[]> {

        const result: CodespaceSecretMeta[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`${secretsUri}?per_page=100&page=${pageNr}`, this.getRequestHeaders(accessToken));

            const nextBatch = response.data?.secrets;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch);
        }

        return result;
    }

    private async getUserOrgs(accessToken: string): Promise<string[]> {

        const result: string[] = [];

        let pageNr = 0;
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const response = await axios.get(`https://api.github.com/user/orgs?per_page=100&page=${pageNr}`, this.getRequestHeaders(accessToken));

            const nextBatch: { login: string }[] = response.data;
            if (!nextBatch?.length) {
                break;
            }

            result.push(...nextBatch.map(b => b.login));
        }

        return result;
    }

    private async getQuickPickOptionsForPersonalSecrets(): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string }[]> {

        const githubSession = await vscode.authentication.getSession('github', ['codespace:secrets'], { createIfNone: true } );

        const secrets = await (this.getCodespacesSecrets(`https://api.github.com/user/codespaces/secrets`, githubSession.accessToken).catch(err => {
        
            this._log(`Failed to load Codespaces personal secrets. ${err.message ?? err}`, true, true);

            return [];
        }));

        return secrets.map(secret => { 
            return {
                label : secret.name,
                detail: `created ${secret.created_at.slice(0, 19)}`,
                description: !!process.env[secret.name] ? 'available on this machine' : undefined
            };
        });    
    }

    private async getQuickPickOptionsForOrganizationSecrets(): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string }[]> {

        const githubSession = await vscode.authentication.getSession('github', ['user admin:org'], { createIfNone: true } );

        const orgs = await (this.getUserOrgs(githubSession.accessToken).catch(err => {
        
            this._log(`Failed to get user organizations. ${err.message ?? err}`, true, true);

            return [];
        }));

        const secretPromises = orgs.map(org => this.getCodespacesSecrets(`https://api.github.com/orgs/${org}/codespaces/secrets`, githubSession.accessToken).catch(err => {

            this._log(`Failed to get Codespaces secrets for organization ${org}. ${err.message ?? err}`, true, true);

            return [];
        }));

        const allSecrets = await Promise.all(secretPromises);

        const options = [];
        for (let i = 0; i < orgs.length; i++) {
            
            const org = orgs[i];
            const secrets = allSecrets[i];
            if (!secrets.length) {
                continue;
            }

            options.push({
                label: org,
                kind: vscode.QuickPickItemKind.Separator
            });

            for (const secret of secrets) {

                options.push({
                    label : secret.name,
                    detail: `created ${secret.created_at.slice(0, 19)}`,
                    description: !!process.env[secret.name] ? 'available on this machine' : undefined
                });
            }
        }

        return options;
    }

    private async getQuickPickOptionsForRepoSecrets(repoFullName: string): Promise<{ label: string, kind?: vscode.QuickPickItemKind, detail?: string }[]> {

        const githubSession = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true } );

        const secrets = await this.getCodespacesSecrets(`https://api.github.com/repos/${repoFullName}/codespaces/secrets`, githubSession.accessToken).catch(err => {

            this._log(`Failed to get Codespaces secrets for repository ${repoFullName}. ${err.message ?? err}`, true, true);

            return [];
        });

        return secrets.map(secret => { 
            return {
                label : secret.name,
                detail: `created ${secret.created_at.slice(0, 19)}`,
                description: !!process.env[secret.name] ? 'available on this machine' : undefined
            };
        });    
    }
} 
