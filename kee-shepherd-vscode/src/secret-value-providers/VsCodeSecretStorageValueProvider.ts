import * as vscode from 'vscode';

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { ControlledSecret } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";

// Implements picking and retrieving secret values from VsCode SecretStorage
export class VsCodeSecretStorageValueProvider implements ISecretValueProvider {

    constructor(private readonly _context: vscode.ExtensionContext, protected readonly _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const secretValue = await this._context.secrets.get(secret.name);

        return secretValue ?? '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        throw new Error('Picking up a secret from VsCode SecretStorage is not supported');
    }
}
