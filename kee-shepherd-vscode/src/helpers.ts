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
