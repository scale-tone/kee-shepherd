import { ControlledSecret } from "./KeyMetadataHelpers";

export interface IKeyMetadataRepo {

    getSecrets(path: string, machineName?: string): Promise<ControlledSecret[]>;
    addSecret(secret: ControlledSecret): Promise<void>;
    removeSecrets(filePath: string, names: string[], machineName?: string): Promise<void>;
    getHash(str: string): string;
}