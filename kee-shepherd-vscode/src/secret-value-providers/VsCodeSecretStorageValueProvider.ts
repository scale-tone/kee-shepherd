import * as os from 'os';
import * as vscode from 'vscode';

import { AzureAccountWrapper } from "../AzureAccountWrapper";
import { SettingNames } from '../KeeShepherd';
import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";
import { ISecretValueProvider, SelectedSecretType } from "./ISecretValueProvider";

// Implements picking and retrieving secret values from VsCode SecretStorage
export class VsCodeSecretStorageValueProvider implements ISecretValueProvider {

    constructor(private readonly _context: vscode.ExtensionContext, protected readonly _account: AzureAccountWrapper) { }

    async getSecretValue(secret: ControlledSecret): Promise<string> {

        const secretValue = await this._context.secrets.get(secret.properties?.name ?? secret.name);

        return secretValue ?? '';
    }

    async pickUpSecret(): Promise<SelectedSecretType | undefined> {

        const secretNames = this._context.globalState.get(SettingNames.VsCodeSecretStorageSecretNames) as string[];

        if (!secretNames?.length) {
            
            throw new Error('No secrets found in VsCode SecretStorage');
        }

        const secretName = await vscode.window.showQuickPick(secretNames, { title: 'Select secret' });
        if (!secretName) {
            return;
        }

        const secretValue = await this._context.secrets.get(secretName);

        if (!secretValue) {
            return;
        }

        return {
            type: SecretTypeEnum.VsCodeSecretStorage,
            name: secretName,
            value: secretValue,
            properties: {
                name: secretName,
                machineName: os.hostname()
            }
        };
    }
}
