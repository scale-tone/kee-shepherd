import { ControlledSecret, SecretTypeEnum } from "../KeyMetadataHelpers";

export type SelectedSecretType = { type: SecretTypeEnum, name: string, value: string, properties: any };

// Implements picking and retrieving secret values from various sources
export interface ISecretValueProvider {

    getSecretValue(secret: ControlledSecret): Promise<string>;
    pickUpSecret(): Promise<SelectedSecretType | undefined>;
}
