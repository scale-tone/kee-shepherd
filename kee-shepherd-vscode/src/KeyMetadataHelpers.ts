import * as path from 'path';
import * as Crypto from 'crypto';

export const ShortcutsSpecialMachineName = '|KeeShepherdSecretShortcuts|';

export const AnchorPrefix = '@KeeShepherd';

export function getAnchorName(secretName: string): string {
    return `${AnchorPrefix}(${secretName})`;
}

// Supported metadata storages
export enum StorageTypeEnum {
    Local = 1,
    AzureTable
}

export enum SecretTypeEnum {
    Unknown = 0,
    AzureKeyVault,
    AzureStorage,
    ResourceManagerRestApi,
    AzureServiceBus,
    AzureEventHubs,
    AzureCosmosDb,
    AzureRedisCache,
    AzureAppInsights,
    AzureEventGrid,
    AzureMaps,
    AzureCognitiveServices,
    AzureSearch,
    AzureSignalR,
    AzureDevOpsPAT,
    Codespaces,
    VsCodeSecretStorage
}

export enum ControlTypeEnum {
    Supervised = 0,
    Managed,
    EnvVariable
}

export type SecretReference = {

    name: string;
    type: SecretTypeEnum;
    properties?: any;
};

export type ControlledSecret = {

    name: string;
    type: SecretTypeEnum;
    controlType: ControlTypeEnum;
    filePath: string;
    hash: string;
    length: number;
    timestamp: Date;
    properties?: any;
};

export class SecretNameConflictError extends Error {

    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, SecretNameConflictError.prototype);
    }
}

export const MinSecretLength = 5;

export function getSha256Hash(str: string): string {

    return Crypto.createHash('sha256').update(str).digest('base64');
}

export function getWeakHash(str: string): number {

    var hashCode = 0;
    for (var i = 0; i < str.length; i++) {
        hashCode = ((hashCode << 5) - hashCode) + str.charCodeAt(i);
        // Convert to positive 32-bit integer
        hashCode &= 0x7FFFFFFF;
    }

    return hashCode;
}

export function encodePathSegment(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
}

export function getFullPathThatFits(baseFolderName: string, proposedFolderName: string, fileName: string): string {

    var result = path.join(baseFolderName, proposedFolderName, fileName);

    // Limiting the full path length
    const maxPathLength = 250;
    if (result.length > maxPathLength) {

        // If doesn't fit, using folder's hash instead
        proposedFolderName = getWeakHash(proposedFolderName).toString();
        result = path.join(baseFolderName, proposedFolderName, fileName);
    }
 
    return result;
}

export function toDictionary(values: string[], mapper: (n: string) => string): { [n: string]: string } {
    
    const result: { [n: string]: string } = {};

    for (const v of values) {
        result[v] = mapper(v);
    }

    return result;
}