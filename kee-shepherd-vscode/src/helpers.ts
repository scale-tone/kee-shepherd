import * as os from 'os';
import * as fs from 'fs';
import { exec } from 'child_process';

import * as vscode from 'vscode';

import { AnchorPrefix } from "./KeyMetadataHelpers";

export type Log = (s: string, withEof: boolean, withTimestamp: boolean) => void;

export function timestampToString(ts: Date): string {

    try {

        if (!ts) {
            return '';
        }

        const milliseconds = (new Date().getTime() - ts.getTime());
        if (milliseconds <= 0) {
            return '';
        }

        const days = Math.floor(milliseconds / 86400000);

        if (days <= 0) {
            return 'created today';
        }

        const years = Math.floor(days / 365);

        if (years > 1) {
            
            return `created ${years} years ago`;

        } else if (years === 1) {
            
            return `created 1 year ago`;
        }

        const months = Math.floor(days / 30);

        if (months > 1) {
            
            return `created ${months} months ago`;

        } else if (months === 1) {
            
            return `created 1 month ago`;
        }

        if (days === 1) {
            
            return `created 1 day ago`;

        } else {

            return `created ${days} days ago`;
        }

    } catch {
        return '';
    }
}

export async function askUserForSecretName(defaultSecretName: string | undefined = undefined): Promise<string | undefined> {

    if (!defaultSecretName) {
        
        defaultSecretName = `${vscode.workspace.name}_secret${new Date().getMilliseconds()}`
            .replace(/-/g, `_`)
            .replace(/[ \[\]]/g, ``);
    }

    const secretName = await vscode.window.showInputBox({
        value: defaultSecretName,
        prompt: 'Give your secret a name',

        validateInput: (n: string) => {

            if (!n) {
                return 'Provide a non-empty secret name';
            }

            if (n.startsWith(AnchorPrefix)) {
                return `Secret name should not start with ${AnchorPrefix}`;
            }

            return null;
        }
    });

    return secretName;
}

export async function getAuthSession(providerId: string, scopes: string[]): Promise<vscode.AuthenticationSession> {

    // First trying silent mode
    let authSession = await vscode.authentication.getSession(providerId, scopes, { silent: true });

    if (!!authSession) {
        
        return authSession;
    }

    // Now asking to authenticate, if needed
    authSession = await vscode.authentication.getSession(providerId, scopes, { createIfNone: true });

    return authSession;        
}

export async function askUserForDifferentNonEmptySecretName(defaultSecretName: string): Promise<string> {

    while (true) {

        const secretName = await vscode.window.showInputBox({
            value: defaultSecretName,
            prompt: `Secret named ${defaultSecretName} already exists. Provide a different name.`,

            ignoreFocusOut: true,
            validateInput: (n: string) => {

                if (!n) {
                    return 'Provide a non-empty secret name';
                }

                if (n.startsWith(AnchorPrefix)) {
                    return `Secret name should not start with ${AnchorPrefix}`;
                }

                if (n === defaultSecretName) {
                    return 'Secret with that name already exists. Provide a different name.';
                }

                return null;
            }
        });

        if (!!secretName) {
            
            return secretName;
        }                
    }
}

export async function areEnvVariablesSet(names: string[], log: Log): Promise<{ [n: string]: boolean }> {

    const result: { [n: string]: boolean } = {};

    if (process.platform === "win32") {

        const promises = names.map(name => new Promise<void>((resolve) => {

            // On Windows reading directly from registry
            exec(`reg query HKCU\\Environment /v ${name}`, (err, stdout) => {

                if (!err) {

                    var value = stdout.trim();
                    if (value !== `%${name}%`) {

                        result[name] = true;
                    }
                }

                resolve();
           });

        }));

        await Promise.all(promises);

    } else {

        // Didn't find any better way to determine the current state of the variable, other than reading ~/.bashrc directly
        const filePath = os.homedir() + '/.bashrc';
        var fileText = '';
        try {

            fileText = Buffer.from(await fs.promises.readFile(filePath)).toString();
            
        } catch (err) {

            log(`Failed to read ${filePath}. ${(err as any).message ?? err}`, true, true);
        }

        for (const name of names) {

            const regex = new RegExp(`export ${name}=.*`, 'g');
            result[name] = !!regex.exec(fileText);
        }
    }

    return result;
}

export function extractSubscriptionIdFromResourceId(resourceId: string): string | undefined {

    const match = /\/subscriptions\/([^\/]+)\/resourceGroups/gi.exec(resourceId);

    return !!match ? match[1] : undefined;
}