import { ControlledSecret } from "../KeyMetadataHelpers";

// Generic interface for key metadata repo implementations
export interface IKeyMetadataRepo {

    getMachineNames(): Promise<string[]>;

    getFolders(machineName: string): Promise<string[]>;

    getSecrets(path: string, exactMatch: boolean, machineName?: string): Promise<ControlledSecret[]>;

    getAllCachedSecrets(): Promise<ControlledSecret[]>;

    refreshCache(): void;

    addSecret(secret: ControlledSecret): Promise<void>;

    removeSecrets(filePath: string, names: string[], machineName?: string): Promise<void>;

    removeAllSecrets(machineName?: string): Promise<void>;

    findBySecretName(name: string): Promise<ControlledSecret[]>;

    calculateHash(str: string): string;

    updateHashAndLength(oldHash: string, newHash: string, newLength: number): Promise<void>;

    createFolder(name: string): Promise<void>;

    removeFolder(name: string): Promise<void>;

    get type(): MetadataRepoType;
}

export enum MetadataRepoType {
    LocalFiles = 0,
    AzureTable
}