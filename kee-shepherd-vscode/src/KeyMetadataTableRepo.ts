import * as os from 'os';
import * as path from 'path';
import * as Crypto from 'crypto';

import { TableServiceClient, TableClient, TableEntity } from '@azure/data-tables';

import { ControlledSecret, encodePathSegment, getSha256Hash, SecretTypeEnum, ControlTypeEnum, MinSecretLength, EnvVariableSpecialPath } from './KeyMetadataHelpers';
import { IKeyMetadataRepo } from './IKeyMetadataRepo';
import { AzureAccountWrapper } from './AzureAccountWrapper';
import { StorageManagementClient } from '@azure/arm-storage';
import { AzureNamedKeyCredential } from '@azure/core-auth';

const SaltKey = '|KeeShepherdSalt|'

// Stores secret metadata in an Azure Table
export class KeyMetadataTableRepo implements IKeyMetadataRepo {

    private constructor(private _tableClient: TableClient, private _salt: string) { }

    static async create(subscriptionId: string,
        resourceGroupName: string,
        storageAccountName: string,
        tableName: string,
        account: AzureAccountWrapper): Promise<KeyMetadataTableRepo> {
        
        // TokenCredential doesn't work with TableServiceClient, need to investigate exactly why
        // Until then using access keys

        const credentials = await account.getTokenCredentials(subscriptionId);
        
        const storageManagementClient = new StorageManagementClient(credentials, subscriptionId);
       
        const storageKeys = await storageManagementClient.storageAccounts.listKeys(resourceGroupName, storageAccountName);
        if (!storageKeys || !storageKeys.keys || storageKeys.keys.length <= 0) {
            throw new Error('Failed to retrieve storage key');
        }

        // Choosing the key that looks best
        var storageKey = storageKeys.keys.find(k => !k.permissions || k.permissions.toLowerCase() === "full");
        if (!storageKey) {
            storageKey = storageKeys.keys.find(k => !k.permissions || k.permissions.toLowerCase() === "read");
        }
        if (!storageKey) {
            throw new Error('Failed to retrieve storage key');
        }
        
        const storageCredential = new AzureNamedKeyCredential(storageAccountName, storageKey.value!);
        const storageUrl = `https://${storageAccountName}.table.core.windows.net`;

        const tableServiceClient = new TableServiceClient(storageUrl, storageCredential, undefined);

        // Making sure the table exists
        await tableServiceClient.createTable(tableName);
            
        const tableClient = new TableClient(storageUrl, tableName, storageCredential);

        // Reading or creating salt
        var salt = Crypto.randomBytes(128).toString('hex');
        try {

            await tableClient.createEntity({ partitionKey: SaltKey, rowKey: SaltKey, value: salt });            
            
        } catch (err) {

            const result = await tableClient.getEntity(SaltKey, SaltKey);

            salt = result.value as string;
        }

        return new KeyMetadataTableRepo(tableClient, salt);
    }

    async findBySecretName(name: string): Promise<ControlledSecret[]> {

        // No other option here but doing a full scan 
        const response = await this._tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey ne '${SaltKey}'`
            }
        });

        const secrets: ControlledSecret[] = [];
        for await (const entity of response) {

            const secret = this.fromTableEntity(entity as any);

            if (secret.name === name) {
                secrets.push(secret)
            }
        }

        return secrets;
    }

    async getMachineNames(): Promise<string[]> {

        const response = await this._tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey ne '${SaltKey}'`
            }
        });

        const machines: any = {};
        var localMachineExists = false;
        for await (const entity of response) {

            machines[entity.partitionKey!] = '';

            if (entity.partitionKey?.toLowerCase() === os.hostname().toLowerCase()) {
                localMachineExists = true;
            }
        }

        // Always showing local machine
        if (!localMachineExists) {
            machines[os.hostname()] = '';
        }

        return Object.keys(machines);
    }

    async getFolders(machineName: string): Promise<string[]> {

        const response = await this._tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey eq '${encodePathSegment(machineName)}'`
            }
        });

        const folders: any = {};
        for await (const entity of response) {

            // If it is an environment
            if (entity.rowKey?.startsWith(EnvVariableSpecialPath)) {
                folders[EnvVariableSpecialPath] = '';
                continue;
            }

            const secret = this.fromTableEntity(entity as any);
            folders[path.dirname(secret.filePath)] = '';
        }

        return Object.keys(folders);
    }

    calculateHash(str: string): string {

        return getSha256Hash(str + this._salt);
    }

    async updateHashAndLength(oldHash: string, newHash: string, newLength: number): Promise<void> {

        const response = await this._tableClient.listEntities({
            queryOptions: {
                filter: `hash eq '${oldHash}'`
            }
        });

        for await (const entity of response) {

            const secret = this.fromTableEntity(entity as any);

            secret.hash = newHash;
            secret.length = newLength;

            await this._tableClient.updateEntity(this.toTableEntity(secret, entity.partitionKey!, entity.rowKey!));
        }
    }

    async addSecret(secret: ControlledSecret): Promise<void> {

        if (secret.length < MinSecretLength) {
            throw new Error(`Secret should be at least ${MinSecretLength} symbols long`);
        }

        const partitionKey = encodePathSegment(os.hostname());
        var rowKey;

        if (secret.controlType === ControlTypeEnum.EnvVariable) {
            
            rowKey = EnvVariableSpecialPath + '|' + encodePathSegment(secret.name);

        } else {

            rowKey = encodePathSegment(secret.filePath) + '|' + encodePathSegment(secret.name);
        }

        try {

            const existingHash = (await this._tableClient.getEntity(partitionKey, rowKey)).hash;

            if (existingHash !== secret.hash) {
                
                throw new Error('A secret with same name but different hash already exists');
            }
            
        } catch (err) {

            if ((err as any).statusCode !== 404) {
                throw err;
            }
        }

        await this._tableClient.upsertEntity(this.toTableEntity(secret, partitionKey, rowKey));
    }

    async getSecrets(path: string, exactMatch: boolean, machineName?: string): Promise<ControlledSecret[]> {

        if (!machineName) {
            machineName = os.hostname();
        }

        const greaterOrEqual = path === EnvVariableSpecialPath ? EnvVariableSpecialPath : encodePathSegment(path);
        const lessThan = greaterOrEqual.substr(0, greaterOrEqual.length - 1) + String.fromCharCode( greaterOrEqual.charCodeAt(greaterOrEqual.length - 1) + 1 );

        const filter = `PartitionKey eq '${encodePathSegment(machineName)}' and RowKey ge '${greaterOrEqual}' and RowKey lt '${lessThan}'`;

        const response = await this._tableClient.listEntities({ queryOptions: { filter } });

        const secrets: ControlledSecret[] = [];
        for await (const entity of response) {

            const secret = this.fromTableEntity(entity as any);

            if (!exactMatch || path === EnvVariableSpecialPath || secret.filePath.toLowerCase() === path.toLowerCase()) {
               
                secrets.push(secret);
            }
        }

        return secrets;
    }

    async removeSecrets(filePath: string, names: string[], machineName?: string): Promise<void> {

        if (!machineName) {
            machineName = os.hostname();
        }

        const promises = names.map(async secretName => {

            const rowKey = (filePath === EnvVariableSpecialPath ? EnvVariableSpecialPath : encodePathSegment(filePath)) + '|' + encodePathSegment(secretName);
            try {

                await this._tableClient.deleteEntity(encodePathSegment(machineName!), rowKey)

            } catch (err) {
                if ((err as any).statusCode !== 404) {
                    throw err;
                }
            }
        });

        await Promise.all(promises);
    }

    async removeAllSecrets(machineName?: string): Promise<void> {

        if (!machineName) {
            machineName = os.hostname();
        }

        const response = await this._tableClient.listEntities({
            queryOptions: {
                filter: `PartitionKey eq '${encodePathSegment(machineName)}'`
            }
        });

        const promises: Promise<any>[] = [];

        for await (const entity of response) {

            promises.push(
                this._tableClient.deleteEntity(entity.partitionKey!, entity.rowKey!)
                    .catch(err => { 
                        if (err.statusCode !== 404) {
                            throw err;
                        }
                    })
            );
        }

        await Promise.all(promises);
    }

    private toTableEntity(secret: ControlledSecret, partitionKey: string, rowKey: string): TableEntity {

        return {
            partitionKey, rowKey,
            name: secret.name,
            type: secret.type,
            controlType: secret.controlType,
            filePath: secret.filePath,
            hash: secret.hash,
            length: secret.length,
            properties: !!secret.properties ? JSON.stringify(secret.properties) : undefined
        };
    }

    private fromTableEntity(entity: TableEntity): ControlledSecret {

        return {
            timestamp: new Date(entity.timestamp as string),
            name: entity.name as string,
            type: entity.type as SecretTypeEnum,
            controlType: entity.controlType as ControlTypeEnum,
            filePath: entity.filePath as string,
            hash: entity.hash as string,
            length: entity.length as number,
            properties: !!entity.properties ? JSON.parse(entity.properties as string) : undefined
        }
    }
}