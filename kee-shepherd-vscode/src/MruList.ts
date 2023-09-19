import * as vscode from 'vscode';
import { SecretReference } from './KeyMetadataHelpers';
import { SettingNames } from './SettingNames';

const MAX_MRU_ITEMS = 36;

// Stores/loads list of most recently used secrets
export class MruList {

    constructor(protected readonly _context: vscode.ExtensionContext) { }

    get(): SecretReference[] {

        return this._context.globalState.get(SettingNames.MruList) as SecretReference[] ?? [];
    }

    async add(secret: SecretReference) {

        // Making sure only the required fields are stored in globalState
        const reference: SecretReference = {
            name: secret.name,
            type: secret.type,
            properties: secret.properties
        };
        const referenceJson = JSON.stringify(reference);
        
        const list = this._context.globalState.get(SettingNames.MruList) as SecretReference[] ?? [];

        // Dropping this secret, if already present
        let i = list.length;
        while (i--) {

            if (JSON.stringify(list[i]) === referenceJson) {

                list.splice(i, 1);
            }
        }

        // Cleanup, if needed
        while (list.length >= MAX_MRU_ITEMS) {
            
            list.pop();
        }

        // Inserting this secret at the top
        list.unshift(reference);

        await this._context.globalState.update(SettingNames.MruList, list);
    }

    async remove(secret: SecretReference) {

        // Making sure only the required fields are stored in globalState
        const reference: SecretReference = {
            name: secret.name,
            type: secret.type,
            properties: secret.properties
        };
        const referenceJson = JSON.stringify(reference);
        
        const list = this._context.globalState.get(SettingNames.MruList) as SecretReference[] ?? [];

        // Dropping this secret
        let i = list.length;
        while (i--) {

            if (JSON.stringify(list[i]) === referenceJson) {

                list.splice(i, 1);
            }
        }

        await this._context.globalState.update(SettingNames.MruList, list);
    }
}