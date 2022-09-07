import * as vscode from 'vscode';
import axios from "axios";

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";

type CodespaceSecretMeta = { name: string, created_at: string, updated_at: string, visibility: string };

// Implements picking and retrieving secret values from GitHub Codespace Secrets
export class CodespaceSecretValueProvider implements ISecretValueProvider {

    constructor(protected _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        // Codespace Secrets appear as env variables, so we just take the value from there
        return process.env[secret.name] as string;
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const githubSession = await vscode.authentication.getSession('github', ['codespace:secrets'], { createIfNone: true } );

        const secrets: CodespaceSecretMeta[] = [];

        const secretsUri = `https://api.github.com/user/codespaces/secrets?per_page=100`;
        let pageNr = 0;
        
        while (true) {

            // Yes, page numbers start from _1_ there, not from 0
            pageNr++;
            const secretsResponse = await axios.get(`${secretsUri}&page=${pageNr}`, { headers: { 'Authorization': `Bearer ${githubSession.accessToken}`, 'Accept': 'application/vnd.github+json' }});

            const nextBatch: CodespaceSecretMeta[] = secretsResponse.data?.secrets;
            if (!nextBatch?.length) {
                break;
            }

            secrets.push(...nextBatch);
        }

        const options = secrets.map(secret => { 
            return {
                label : secret.name,
                detail: `created ${secret.created_at.slice(0, 10)}`
            };
        });

        const selectedSecret = await vscode.window.showQuickPick(options, { title: 'Select Codespaces Secret' });
        if (!selectedSecret) {
            return;
        }

        const secretValue = process.env[selectedSecret.label];
        if (!secretValue) {

            throw new Error(`Failed to get the value of ${selectedSecret.label}. If you just created it, you might need to reload your Codespaces instance for that secret to take effect. Also make sure that this secret is available for current repository.`);
        }

        return {
            type: SecretTypeEnum.CodespaceSecret,
            name: selectedSecret.label,
            value: secretValue!,
            properties: {}
        };
    }
} 
