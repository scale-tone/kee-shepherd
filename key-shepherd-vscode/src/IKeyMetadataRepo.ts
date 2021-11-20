import { ControlledSecret } from "./KeyMetadataHelpers";

export interface IKeyMetadataRepo {

    getMachineNames(): Promise<string[]>;

    getFolders(machineName: string): Promise<string[]>;

    getSecrets(path: string, exactMatch: boolean, machineName?: string): Promise<ControlledSecret[]>;

    addSecret(secret: ControlledSecret): Promise<void>;

    removeSecrets(filePath: string, names: string[], machineName?: string): Promise<void>;

    getHash(str: string): string;
}